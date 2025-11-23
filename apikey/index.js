const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
require('dotenv').config();
const mysql = require('mysql2/promise');

const app = express();
const port = process.env.PORT || 3000;

// Konfigurasi Pool Koneksi Database (menggunakan .env/fallback ke localhost:3309)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'apikey',
    port: process.env.DB_PORT || 3309,
    connectionLimit: 10,
});

// Konfigurasi Middleware dan Session Admin
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'RAHASIA_SUPER_AMAN',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

// Middleware Admin
const isAdminLoggedIn = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ status: 'error', message: 'Unauthorized. Silakan login.' });
    }
};

// Route utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --------------------------------------------------------------
// ROUTE PUBLIC/TRANSACTION
// --------------------------------------------------------------

// 1.1. ROUTE /CREATE: HANYA MEMBUAT KEY DI MEMORI
app.post('/create', async (req, res) => {
    const randomBytes = crypto.randomBytes(16).toString('hex').toUpperCase();
    const apiKey = `Putra-${randomBytes.slice(0, 8)}-${randomBytes.slice(8, 16)}-${randomBytes.slice(16, 24)}-${randomBytes.slice(24, 32)}`;

    res.json({
        apiKey: apiKey,
        status: 'success',
        message: 'Key berhasil dibuat. Siap untuk didaftarkan.',
    });
});

// 1.2. ROUTE /REGISTER: Menyimpan Key & User dalam Transaksi
app.post('/register', async (req, res) => {
    const { firstName, lastName, email, apiKey } = req.body;

    if (!firstName || !email || !apiKey) { return res.status(400).json({ status: 'error', message: 'Input wajib tidak lengkap.' }); }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. KOREKSI: INSERT USER ke tabel users DULU (Tabel Induk)
        const userSql = `INSERT INTO users (first_name, last_name, email, created_at) VALUES (?, ?, ?, NOW())`;
        const userValues = [firstName, lastName, email];
        const [userResult] = await connection.execute(userSql, userValues);
        const newUserId = userResult.insertId; // <-- KUNCI: Sekarang kita punya ID User!

        // 2. INSERT KEY BARU ke api_keys (Tabel Anak)
        // SQL sekarang MENYERTAKAN fk_user_id
        const keySql = `
            INSERT INTO api_keys (api_key, expires_at, fk_user_id) 
            VALUES (?, DATE_ADD(NOW(), INTERVAL 1 MONTH), ?) 
        `;
        const keyValues = [apiKey, newUserId]; // Menggunakan ID User yang baru didapatkan

        await connection.execute(keySql, keyValues);

        await connection.commit(); // Commit jika kedua INSERT sukses
        
        res.json({ status: 'success', message: 'User dan API Key berhasil didaftarkan.' });
    } catch (error) {
        if (connection) await connection.rollback();

        if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ status: 'error', message: 'Email atau API Key sudah terdaftar.' }); }
        console.error('Error saat menyimpan user:', error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan data user.' });
    } finally {
        if (connection) connection.release();
    }
});


// --------------------------------------------------------------
// ROUTE ADMIN (PROTECTED)
// --------------------------------------------------------------

// 2.1. ADMIN REGISTRASI
app.post('/admin/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).json({ status: 'error', message: 'Email dan password wajib diisi.' }); }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `INSERT INTO admin (email, password) VALUES (?, ?)`;
        await pool.execute(sql, [email, hashedPassword]);
        res.status(201).json({ status: 'success', message: 'Registrasi Admin berhasil. Silakan login.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ status: 'error', message: 'Email Admin sudah terdaftar.' }); }
        res.status(500).json({ status: 'error', message: 'Gagal registrasi admin.' });
    }
});

// 2.2. ADMIN LOGIN
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).json({ status: 'error', message: 'Email dan password wajib diisi.' }); }

    try {
        const [rows] = await pool.execute('SELECT id, password FROM admin WHERE email = ?', [email]);
        if (rows.length === 0) { return res.status(401).json({ status: 'error', message: 'Email atau password salah.' }); }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) { return res.status(401).json({ status: 'error', message: 'Email atau password salah.' }); }

        req.session.isAdmin = true;
        req.session.userId = user.id;

        res.json({ status: 'success', message: 'Login berhasil!', redirect: '/admin.html' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Gagal login.' });
    }
});

// 2.3. ADMIN LOGOUT
app.post('/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) { return res.status(500).json({ status: 'error', message: 'Gagal logout.' }); }
        res.json({ status: 'success', message: 'Logout berhasil.' });
    });
});


// 2.4. AMBIL SEMUA USER (PROTECTED ROUTE - FIX LOGIC DISPLAY)
app.get('/admin/users', isAdminLoggedIn, async (req, res) => {
    try {
        // QUERY FINAL: Mengambil data yang dibutuhkan frontend dengan status yang benar
        const sql = `
            SELECT 
                u.id, u.first_name, u.last_name, u.email, 
                a.api_key, a.expires_at, a.is_active,
                -- Status Aktif: Jika is_active=1 DAN expires_at > NOW()
                CASE WHEN a.is_active = 1 AND a.expires_at > NOW() THEN 1 ELSE 0 END AS active_status_code
            FROM users u
            JOIN api_keys a ON u.id = a.fk_user_id
            ORDER BY u.created_at DESC
        `;
        const [users] = await pool.execute(sql);
        res.json({ status: 'success', data: users });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Gagal mengambil data user.' });
    }
});


// 2.5. HAPUS USER (PROTECTED ROUTE - Diperbaiki untuk relasi 1:N)
app.delete('/admin/users/:userId', isAdminLoggedIn, async (req, res) => {
    const userId = req.params.userId;

    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Hapus SEMUA keys terkait dari tabel api_keys
            await connection.execute('DELETE FROM api_keys WHERE fk_user_id = ?', [userId]);

            // 2. Hapus entri dari tabel users (induk)
            await connection.execute('DELETE FROM users WHERE id = ?', [userId]);

            await connection.commit();
            res.json({ status: 'success', message: 'User dan API Key terkait berhasil dihapus.' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Gagal menghapus user.' });
    }
});

// 2.6. CEK STATUS LOGIN (RINGAN)
app.get('/admin/status-check', (req, res) => {
    if (req.session.isAdmin) {
        return res.json({ loggedIn: true, message: "Session aktif." });
    }
    res.status(401).json({ loggedIn: false, message: "Belum login." });
});


// 3. SERVER STARTUP
app.listen(port, async () => {
    try {
        await pool.getConnection();
        console.log('✅ KONEKSI DATABASE APIKEY BERHASIL!');
    } catch (e) {
        console.error('❌ GAGAL KONEKSI KE DATABASE! Cek .env dan status MySQL server Anda.', e.message);
    }
    console.log(`🚀 Server berjalan di http://localhost:${port}`);
});