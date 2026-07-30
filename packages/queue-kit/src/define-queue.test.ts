import { Redis } from "ioredis";
import { createLogger } from "@omni/observability";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { defineQueue, type DefinedQueue } from "./define-queue";
import { deadLetterQueueName } from "./queue-names";

const redisUrl = process.env.REDIS_URL;
const logger = createLogger({ service: "queue-kit-test", level: "silent", pretty: false });

interface Payload {
  value: string;
}

/**
 * Prova o comportamento que a política de retry sozinha não garante:
 * que o job é realmente enfileirado, retentado e movido para a DLQ.
 * Precisa de Redis real — o BullMQ roda scripts Lua no servidor.
 */
describe.skipIf(!redisUrl)("defineQueue (integração com Redis)", () => {
  const created: DefinedQueue<Payload>[] = [];
  let connection: Redis;
  let queueName: string;

  beforeEach(() => {
    queueName = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    await Promise.all(created.map((queue) => queue.close()));
    if (connection) {
      await connection.quit();
    }
  });

  function makeQueue(policy?: Parameters<typeof defineQueue>[0]["policy"]) {
    connection ??= new Redis(redisUrl!, { maxRetriesPerRequest: null });
    const queue = defineQueue<Payload>({
      name: queueName,
      connection,
      logger,
      policy,
    });
    created.push(queue);
    return queue;
  }

  it("processa um job enfileirado", async () => {
    const queue = makeQueue();
    const processed: string[] = [];

    const worker = queue.createWorker(async (job) => {
      processed.push(job.data.value);
    });

    await queue.enqueue("job-1", { value: "oi" });
    await waitFor(() => processed.length === 1);
    await worker.close();

    expect(processed).toEqual(["oi"]);
  });

  it("não enfileira duas vezes o mesmo jobId", async () => {
    const queue = makeQueue();

    await queue.enqueue("mesmo-id", { value: "a" });
    await queue.enqueue("mesmo-id", { value: "b" });

    expect(await queue.queue.getWaitingCount()).toBe(1);
  });

  it("aceita chave de idempotência com ':', que o BullMQ recusaria", async () => {
    const queue = makeQueue();
    const processed: string[] = [];

    const worker = queue.createWorker(async (job) => {
      processed.push(job.data.value);
    });

    await queue.enqueue("upload:rec-1", { value: "com-dois-pontos" });
    await waitFor(() => processed.length === 1);
    await worker.close();

    expect(processed).toEqual(["com-dois-pontos"]);
  });

  it("retenta antes de desistir e move para a DLQ ao esgotar as tentativas", async () => {
    const queue = makeQueue({ attempts: 3, backoffDelayMs: 10 });
    let tentativas = 0;

    const worker = queue.createWorker(async () => {
      tentativas += 1;
      throw new Error("falha simulada");
    });

    await queue.enqueue("vai-falhar", { value: "x" });
    await waitFor(async () => (await queue.deadLetterQueue.getWaitingCount()) === 1, 15000);
    await worker.close();

    expect(tentativas).toBe(3);

    const [dlqJob] = await queue.deadLetterQueue.getJobs(["waiting"]);
    expect(dlqJob?.data).toEqual({ value: "x" });
    expect(queue.deadLetterQueue.name).toBe(deadLetterQueueName(queueName));
    // O backoff exponencial entre as tentativas não cabe no timeout padrão.
  }, 30000);

  it("não manda para a DLQ um job que teve sucesso na retentativa", async () => {
    const queue = makeQueue({ attempts: 3, backoffDelayMs: 10 });
    let tentativas = 0;

    const worker = queue.createWorker(async () => {
      tentativas += 1;
      if (tentativas < 2) {
        throw new Error("falha transitória");
      }
    });

    await queue.enqueue("recupera", { value: "y" });
    await waitFor(async () => (await queue.queue.getCompletedCount()) === 1, 15000);
    await worker.close();

    expect(tentativas).toBe(2);
    expect(await queue.deadLetterQueue.getWaitingCount()).toBe(0);
  }, 30000);
});

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condição não satisfeita dentro do tempo limite");
}
