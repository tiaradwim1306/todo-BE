import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.DB_HOST,       // Endpoint RDS Anda
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: {
      rejectUnauthorized: true
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});



// Tes koneksi (Opsional)
pool.getConnection()
  .then(connection => {
    console.log('✅ Connected successfully to RDS MySQL!');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.stack);
  });

export default pool;