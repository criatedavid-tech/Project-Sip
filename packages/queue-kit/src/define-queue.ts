import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor } from "bullmq";
import { newCorrelationId, runWithContext, type Logger } from "@omni/observability";
import { deadLetterQueueName } from "./queue-names";
import {
  DEFAULT_RETRY_POLICY,
  buildJobOptions,
  hasExhaustedAttempts,
  type RetryPolicy,
} from "./retry-policy";

export interface DefineQueueOptions {
  name: string;
  connection: ConnectionOptions;
  logger: Logger;
  policy?: Partial<RetryPolicy>;
}

type OmniQueue<TPayload> = Queue<TPayload, unknown, string>;

/**
 * O BullMQ deriva os tipos de nome e payload do job por tipos condicionais que o
 * compilador não resolve enquanto TPayload é genérico. Concentramos o cast aqui:
 * em runtime o nome é sempre string e o payload é sempre TPayload.
 */
function addJob<TPayload>(
  queue: OmniQueue<TPayload>,
  jobName: string,
  payload: TPayload,
  opts: JobsOptions,
): Promise<unknown> {
  return (queue as Queue).add(jobName, payload, opts);
}

export interface DefinedQueue<TPayload> {
  name: string;
  queue: OmniQueue<TPayload>;
  deadLetterQueue: OmniQueue<TPayload>;
  /**
   * jobId é a chave de idempotência da fila. Ela evita reenfileiramento
   * enquanto o job existe no Redis — a garantia definitiva contra duplicidade
   * é a constraint UNIQUE no Postgres, então o processor deve ser idempotente.
   */
  enqueue(jobId: string, payload: TPayload, overrides?: JobsOptions): Promise<void>;
  createWorker(
    processor: Processor<TPayload, unknown, string>,
    concurrency?: number,
  ): Worker<TPayload, unknown, string>;
  close(): Promise<void>;
}

export function defineQueue<TPayload>(
  options: DefineQueueOptions,
): DefinedQueue<TPayload> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
  const { name, connection, logger } = options;

  const queue: OmniQueue<TPayload> = new Queue(name, { connection });
  const deadLetterQueue: OmniQueue<TPayload> = new Queue(deadLetterQueueName(name), {
    connection,
  });

  return {
    name,
    queue,
    deadLetterQueue,

    async enqueue(jobId, payload, overrides) {
      await addJob(queue, name, payload, buildJobOptions(policy, jobId, overrides));
    },

    createWorker(processor, concurrency = 1) {
      const worker = new Worker<TPayload, unknown, string>(
        name,
        async (job, token) =>
          runWithContext({ correlationId: job.id ?? newCorrelationId() }, () =>
            processor(job, token),
          ),
        { connection, concurrency },
      );

      worker.on("failed", (job, error) => {
        if (!job) {
          logger.error({ queue: name, err: error }, "job falhou sem referência");
          return;
        }

        const exhausted = hasExhaustedAttempts(job.attemptsMade, job.opts.attempts);
        logger.warn(
          {
            queue: name,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts,
            exhausted,
            err: error,
          },
          exhausted ? "job esgotou tentativas, movendo para DLQ" : "job falhou, será retentado",
        );

        if (!exhausted) {
          return;
        }

        void addJob(deadLetterQueue, deadLetterQueueName(name), job.data, {
          jobId: `dlq:${job.id}`,
          removeOnComplete: false,
          removeOnFail: false,
        }).catch((dlqError: unknown) => {
          logger.error(
            { queue: name, jobId: job.id, err: dlqError },
            "falha ao mover job para DLQ",
          );
        });
      });

      return worker;
    },

    async close() {
      await Promise.all([queue.close(), deadLetterQueue.close()]);
    },
  };
}
