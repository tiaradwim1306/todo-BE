import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import todoRoutes from './routes/todoRoutes.js';
import dbPool from './config/db.js'; // Memanggil untuk inisialisasi koneksi

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json()); // untuk parsing body application/json

// Routes
app.use('/api', todoRoutes);

// Root Health Check
app.get('/', (req, res) => {
    res.send('To-Do List Backend is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

// Handle graceful shutdown (optional)
process.on('SIGINT', () => {
    console.log('Server shutting down...');
    dbPool.end(); // Tutup koneksi pool RDS
    process.exit(0);
});