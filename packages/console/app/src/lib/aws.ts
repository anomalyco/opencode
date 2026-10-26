import { Resource } from "@opencode/console-resource"
import { AwsClient } from "aws4fetch"

let client: AwsClient | undefined

export async function sendEmail(input: { to: string; subject: string; body: string; text?: string; replyTo?: string }) {
  client ??= new AwsClient({
    accessKeyId: Resource.AWS_SES_ACCESS_KEY_ID.value,
    secretAccessKey: Resource.AWS_SES_SECRET_ACCESS_KEY.value,
    region: "us-east-1",
  })
  const res = await client.fetch("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails", {
    method: "POST",
    headers: {
      "X-Amz-Target": "SES.SendEmail",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      FromEmailAddress: `OpenCode Zen <contact@anoma.ly>`,
      Destination: {
        ToAddresses: [input.to],
      },
      ...(input.replyTo && { ReplyToAddresses: [input.replyTo] }),
      Content: {
        Simple: {
          Subject: {
            Charset: "UTF-8",
            Data: input.subject,
          },
          Body: {
            Text: {
              Charset: "UTF-8",
              Data: input.text ?? input.body,
            },
            Html: {
              Charset: "UTF-8",
              Data: input.body,
            },
          },
        },
      },
    }),
  })
  if (!res.ok) throw new Error(`Failed to send email: ${res.statusText}`)
}
