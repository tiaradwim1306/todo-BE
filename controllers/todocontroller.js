import dbPool from '../config/db.js';
import s3Client, { S3_BUCKET_NAME } from '../config/aws.js';
import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import path from 'path';

// --- UTILITY FUNCTIONS ---

const getS3KeyFromUrl = (url) => {
    if (!url) return null;
    try {
        const parsedUrl = new URL(url);
        // Menghilangkan '/' di awal pathname untuk mendapatkan Key S3
        return parsedUrl.pathname.substring(1); 
    } catch (e) {
        return null;
    }
};

const uploadToS3 = async (file) => {
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    // Membersihkan nama file untuk S3 Key
    const s3Key = `${timestamp}_${file.originalname.replace(extension, '').replace(/\s/g, '_')}${extension}`;

    const params = {
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: file.buffer, 
        ContentType: file.mimetype,
    };

    try {
        const upload = new Upload({
            client: s3Client,
            params: params,
        });

        const result = await upload.done();
        
        return { 
            s3Url: result.Location, 
            s3Key: s3Key 
        };
    } catch (error) {
        console.error("S3 Upload Failed:", error);
        // Melempar error agar ditangkap oleh blok catch utama
        throw new Error("Gagal mengunggah file ke S3."); 
    }
};

const saveAttachments = async (attachmentsData) => {
    if (attachmentsData.length === 0) return;
    
    // Nilai harus dalam format array of arrays: [[todo_id, file_url, file_name], ...]
    const values = attachmentsData.map(att => [
        parseInt(att.todo_id), 
        att.file_url, 
        att.file_name
    ]); 
    
    const sql = 'INSERT INTO attachments (todo_id, file_url, file_name) VALUES ?';
    
    try {
        await dbPool.query(sql, [values]);
    } catch (error) {
        console.error('Error saving attachments to DB:', error);
        throw new Error('Gagal menyimpan metadata lampiran ke database.'); 
    }
};

// --------------------------------------------------------------------------
// 1. GET (Read All)
// --------------------------------------------------------------------------
export const getTodos = async (req, res) => {
    try {
        // Ambil semua kolom, termasuk task_title
        const [todos] = await dbPool.query('SELECT * FROM todos ORDER BY created_at DESC'); 
        const [attachments] = await dbPool.query('SELECT id, todo_id, file_url, file_name, file_name_shortcut FROM attachments'); // Ambil semua field

        // Gabungkan lampiran ke dalam item To-Do yang sesuai
        const todosWithAttachments = todos.map(todo => {
            return {
                ...todo,
                attachments: attachments.filter(att => att.todo_id === todo.id)
            };
        });

        res.json(todosWithAttachments);
    } catch (error) {
        console.error('Error fetching todos:', error);
        res.status(500).json({ message: 'Internal Server Error during data retrieval.' });
    }
};

// --------------------------------------------------------------------------
// 2. POST (Create)
// --------------------------------------------------------------------------
export const createTodo = async (req, res) => {
    const { day_title, task_number, task_description, task_title } = req.body;
    
    // Mengubah string kosong menjadi null agar sesuai dengan database (jika field boleh null)
    const dayTitleForDB = day_title || null; 
    const taskTitleForDB = task_title || null; 
    
    const sql = 'INSERT INTO todos (day_title, task_number, task_description, task_title) VALUES (?, ?, ?, ?)';
    
    try {
        const [result] = await dbPool.execute(sql, [
            dayTitleForDB, 
            task_number, 
            task_description, 
            taskTitleForDB 
        ]);
        
        const [newTodo] = await dbPool.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);

        res.status(201).json({ 
            message: 'To-Do item created successfully.', 
            data: newTodo[0] 
        });
    } catch (error) {
        console.error('Error creating todo:', error);
        res.status(500).json({ message: 'Internal Server Error', detail: error.message });
    }
};

// --------------------------------------------------------------------------
// 3. PUT (Update) - KODE PERBAIKAN
// --------------------------------------------------------------------------
export const updateTodo = async (req, res) => {
    const { id } = req.params;
    
    // req.body sekarang berisi data teks yang dikirim melalui FormData
    const { task_description, is_completed, day_title, task_title, file_name_shortcut } = req.body; 

    const files = req.files; 
    
    const updateFields = {};

    // =========================================================================
    // ✅ PERBAIKAN DI SINI: MENGURUS is_completed
    // =========================================================================
    if (is_completed !== undefined) {
        // Mengubah string ("0" atau "1") menjadi integer. 
        const statusInt = parseInt(is_completed, 10);
        
        // Memastikan nilai yang diupdate adalah 0 atau 1
        if (statusInt === 0 || statusInt === 1) {
            updateFields.is_completed = statusInt; 
        } else {
            // Opsional: Error handling jika data status tidak valid
            console.warn(`Nilai is_completed tidak valid: ${is_completed}`);
        }
    }
    // =========================================================================

    if (task_description !== undefined) {
        updateFields.task_description = task_description || null; 
    }
    if (day_title !== undefined) {
        updateFields.day_title = day_title || null;
    }
    if (task_title !== undefined) {
        updateFields.task_title = task_title || null; 
    }

    let sql = 'UPDATE todos SET ';
    const params = [];
    
    const fieldNames = Object.keys(updateFields);
    if (fieldNames.length === 0 && (!files || files.length === 0)) {
         return res.status(400).json({ message: 'No fields to update or files to upload.' });
    }
    
    // Buat Query SQL dinamis untuk update teks
    sql += fieldNames.map(field => {
        params.push(updateFields[field]);
        return `${field} = ?`;
    }).join(', ');

    sql += ' WHERE id = ?';
    params.push(id);

    try {
        // 1. UPDATE DATA TEKS DI DATABASE (jika ada field yang diupdate)
        if (fieldNames.length > 0) {
            const [result] = await dbPool.execute(sql, params);
            if (result.affectedRows === 0) {
                // Jangan langsung 404 jika ada file, lanjutkan ke upload
                console.log(`Todo ID ${id} not found for text update.`);
            }
        }
        
        // 2. ✅ KRITIS: LOGIKA UPLOAD DAN SIMPAN ATTACHMENT BARU
        if (files && files.length > 0) {
            const todoId = parseInt(id); 
            const customName = file_name_shortcut; // Ambil dari body
            
            const attachmentsData = await Promise.all(files.map(async (file, index) => {
                const s3Result = await uploadToS3(file);
                
                let fileName = file.originalname;
                // Terapkan custom name (shortcut) hanya jika tersedia dan untuk file pertama
                if (customName && index === 0) { 
                    fileName = customName + path.extname(file.originalname);
                }
                
                return {
                    todo_id: todoId,
                    file_name: fileName,
                    file_url: s3Result.s3Url 
                };
            }));

            // Simpan metadata lampiran ke database
            await saveAttachments(attachmentsData);
        }

        res.json({ message: 'To-Do item and attachments updated successfully.' });

    } catch (error) {
        console.error('Error updating todo and/or attachments:', error);
        // Kirim 500 jika ada error di S3 atau DB Write
        res.status(500).json({ message: 'Internal Server Error during update.', detail: error.message });
    }
};

// --------------------------------------------------------------------------
// 4. DELETE (Todo) - (Tidak berubah secara substansial)
// --------------------------------------------------------------------------
export const deleteTodo = async (req, res) => {
    const { id } = req.params;

    try {
        const [attachments] = await dbPool.query('SELECT file_url FROM attachments WHERE todo_id = ?', [id]);
        
        const [todoItem] = await dbPool.query('SELECT id FROM todos WHERE id = ?', [id]);
        if (todoItem.length === 0) {
            return res.status(404).json({ message: 'To-Do item not found.' });
        }

        await dbPool.execute('DELETE FROM todos WHERE id = ?', [id]);

        if (attachments.length > 0) {
            const deletePromises = attachments.map(att => {
                const s3Key = getS3KeyFromUrl(att.file_url);
                if (s3Key) {
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: S3_BUCKET_NAME,
                        Key: s3Key,
                    });
                    return s3Client.send(deleteCommand);
                }
                return Promise.resolve(); 
            });
            
            await Promise.all(deletePromises);
            console.log(`Successfully deleted ${attachments.length} S3 objects for todo ID: ${id}`);
        }
        
        res.json({ message: 'To-Do item and associated attachments deleted successfully.' });
    } catch (error) {
        console.error('Error deleting todo or S3 attachment:', error);
        res.status(500).json({ message: 'Failed to delete To-Do item and/or attachments.' });
    }
};

// --------------------------------------------------------------------------
// 5. POST (Upload Multiple Attachments ke S3) - (Digunakan jika Anda punya endpoint POST terpisah)
// --------------------------------------------------------------------------
export const uploadMultipleAttachments = async (req, res) => {
    try {
        const todoId = parseInt(req.params.todoId, 10); 
        const files = req.files; 
        
        // ✅ PERBAIKAN: Mengambil nama field yang benar dari frontend (file_name_shortcut)
        const customName = req.body.file_name_shortcut; 

        if (isNaN(todoId)) {
            return res.status(400).json({ message: "ID Tugas tidak valid. Pastikan ID dikirim dengan benar." });
        }
        
        if (!files || files.length === 0) {
            return res.status(400).json({ message: "Tidak ada file yang diunggah." });
        }

        const attachmentsData = await Promise.all(files.map(async (file, index) => {
            const s3Result = await uploadToS3(file);
            const s3Url = s3Result.s3Url;
            
            let fileName = file.originalname;
            if (customName && index === 0) { 
                fileName = customName + path.extname(file.originalname);
            }

            return {
                todo_id: todoId,
                file_name: fileName,
                file_url: s3Url 
            };
        }));
        
        await saveAttachments(attachmentsData);
        
        return res.status(200).json({ message: "Lampiran berhasil diunggah." });

    } catch (error) {
        console.error("Error during file upload/S3 operation:", error);
        return res.status(500).json({ message: "Gagal mengunggah lampiran.", error: error.message });
    }
};

// --------------------------------------------------------------------------
// 6. DELETE Attachment Individu - (sudah kuat)
// --------------------------------------------------------------------------
export const deleteSingleAttachment = async (req, res) => {
    const { id: attachmentId } = req.params; 
    
    if (!attachmentId || attachmentId === 'undefined' || isNaN(parseInt(attachmentId))) {
        return res.status(400).json({ message: 'Attachment ID is missing or invalid.' });
    }
    
    try {
        const [attachment] = await dbPool.query('SELECT file_url FROM attachments WHERE id = ?', [attachmentId]);

        if (attachment.length === 0) {
            return res.status(204).json({ message: 'Attachment not found (already deleted).' });
        }

        const fileUrl = attachment[0].file_url;

        const [result] = await dbPool.execute('DELETE FROM attachments WHERE id = ?', [attachmentId]);
        
        if (fileUrl) {
            const s3Key = getS3KeyFromUrl(fileUrl);
            if (s3Key) {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: S3_BUCKET_NAME,
                    Key: s3Key,
                });
                await s3Client.send(deleteCommand);
                console.log(`Successfully deleted S3 object: ${s3Key}`);
            }
        }
        
        res.json({ message: 'Attachment deleted successfully.' });
    } catch (error) {
        console.error('Error details:', error); 
        res.status(500).json({ message: 'Failed to delete attachment.' });
    }
};

// --------------------------------------------------------------------------
// 7. DELETE Seluruh Grup Berdasarkan day_title - (Tidak berubah)
// --------------------------------------------------------------------------
export const deleteDayGroup = async (req, res) => {
    const { dayTitle } = req.params; 
    const decodedDayTitle = decodeURIComponent(dayTitle);

    try {
        const [attachments] = await dbPool.query(
            `SELECT a.file_url FROM attachments a JOIN todos t ON a.todo_id = t.id WHERE t.day_title = ?`, 
            [decodedDayTitle]
        );
        
        const [result] = await dbPool.execute('DELETE FROM todos WHERE day_title = ?', [decodedDayTitle]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'No tasks found for this day title.' });
        }

        if (attachments.length > 0) {
            const deletePromises = attachments.map(att => {
                const s3Key = getS3KeyFromUrl(att.file_url);
                if (s3Key) {
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: S3_BUCKET_NAME,
                        Key: s3Key,
                    });
                    return s3Client.send(deleteCommand);
                }
                return Promise.resolve();
            });
            await Promise.all(deletePromises);
        }
        
        res.json({ message: `Day group '${decodedDayTitle}' and attachments deleted successfully.` });
    } catch (error) {
        console.error('Error deleting day group:', error);
        res.status(500).json({ message: 'Failed to delete day group.' });
    }
};