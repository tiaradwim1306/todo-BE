import { S3Client } from '@aws-sdk/client-s3';
import 'dotenv/config';

// Pastikan Credential AWS diatur (melalui variabel env atau IAM Role di EC2)
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-southeast-1', // Ganti dengan region S3 Anda
    // Jika menggunakan IAM Role di EC2, tidak perlu 'credentials' di sini
});

export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

export default s3Client;