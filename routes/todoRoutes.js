import { Router } from 'express';
import multer from 'multer';

import { 
    createTodo, 
    getTodos, 
    updateTodo, 
    deleteTodo,
    uploadMultipleAttachments, 
    deleteSingleAttachment,
    deleteDayGroup
} from '../controllers/todoController.js';

// -----------------------------------------------------------
// KONFIGURASI MIDDLEWARE UPLOAD
// -----------------------------------------------------------

// Konfigurasi Multer menggunakan memoryStorage() untuk S3
// Nama variabelnya adalah 'upload'
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // Batas file 5MB
});

const router = Router();

// -----------------------------------------------------------
// ENDPOINTS TO-DO UTAMA
// -----------------------------------------------------------

router.post('/todos', createTodo);      // Membuat To-Do list/item baru
router.get('/todos', getTodos);         // Mengambil semua To-Do

// ✅ PERBAIKAN KRITIS: Tambahkan Multer untuk menerima file pada endpoint PUT.
// File field name yang digunakan frontend adalah 'attachments'
router.put('/todos/:id', upload.array('attachments', 5), updateTodo); 

router.delete('/todos/:id', deleteTodo);  // Menghapus To-Do

// -----------------------------------------------------------
// ENDPOINTS KHUSUS
// -----------------------------------------------------------

// 1. ENDPOINT HAPUS SELURUH GRUP
router.delete('/todos/day/:dayTitle', deleteDayGroup); 

// 2. ENDPOINT UPLOAD FILE KE S3 (Jika digunakan terpisah)
// ✅ PERBAIKAN KRITIS: Gunakan 'attachments' sebagai field name agar konsisten dengan frontend.
router.post('/todos/:todoId/upload', 
    upload.array('attachments', 5), // Field name harus 'attachments', max 5 file
    uploadMultipleAttachments
);

// 3. ENDPOINT HAPUS LAMPIRAN TUNGGAL
router.delete('/attachments/:id', deleteSingleAttachment); 


export default router;