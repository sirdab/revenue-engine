import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// S3-compatible object storage for file attachment blobs (Cloudflare R2,
// AWS S3, MinIO or any other S3-compatible endpoint —
// forcePathStyle covers both). Metadata stays in Postgres (crm_files); only
// the bytes live here, keyed by the crm_files row id.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for object storage.`);
  }
  return value;
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: requireEnv("S3_ENDPOINT"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      },
      // Without an explicit timeout, a stalled R2 connection hangs the
      // request indefinitely (the SDK's default handler has no bound),
      // which stalls the user-facing HTTP request awaiting it.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
      }),
    });
  }
  return client;
}

function keyFor(fileId: number): string {
  return `crm-files/${fileId}`;
}

export async function putObject(
  fileId: number,
  data: Buffer,
  contentType: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: requireEnv("S3_BUCKET_NAME"),
      Key: keyFor(fileId),
      Body: data,
      ContentType: contentType,
    }),
  );
}

export async function getObject(fileId: number): Promise<Buffer> {
  const result = await getClient().send(
    new GetObjectCommand({
      Bucket: requireEnv("S3_BUCKET_NAME"),
      Key: keyFor(fileId),
    }),
  );
  if (!result.Body) {
    throw new Error(`Object storage returned no body for file ${fileId}`);
  }
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteObject(fileId: number): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: requireEnv("S3_BUCKET_NAME"),
      Key: keyFor(fileId),
    }),
  );
}
