export const QUEUE_NAMES = {
  recordingUpload: "recording-upload",
  transcription: "transcription",
  whatsappOutbound: "whatsapp-outbound",
  whatsappWebhookProcess: "whatsapp-webhook-process",
  webhookOutboundDelivery: "webhook-outbound-delivery",
  telephonyCommands: "telephony-commands",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function deadLetterQueueName(queueName: string): string {
  return `${queueName}-dlq`;
}
