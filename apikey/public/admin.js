document.addEventListener('DOMContentLoaded', () => {
    // Panggil fungsi untuk mengecek status saat halaman dimuat
    checkLoginStatus(); 
});

// Fungsi utilitas untuk beralih tampilan
function toggleView(isLoggedIn) {
    const authPage = document.getElementById('auth-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const logoutBtn = document.getElementById('logout-button');
    const message = document.getElementById('admin-message');
    const loginBox = document.getElementById('login-form-box');
    const registerBox = document.getElementById('register-form-box');

    if (isLoggedIn) {
        authPage.style.display = 'none';
        dashboardPage.style.display = 'block';
        logoutBtn.style.display = 'inline-block';
        message.textContent = 'Selamat datang kembali, Administrator.';
        fetchUsers(); // Ambil data user hanya jika sudah login
    } else {
        authPage.style.display = 'block';
        dashboardPage.style.display = 'none';
        logoutBtn.style.display = 'none';
        message.textContent = 'Anda belum login. Silakan login atau registrasi.';
        
        // Atur tampilan awal: Hanya tampilkan Login
        loginBox.style.display = 'block';
        registerBox.style.display = 'none'; 
        
        document.getElementById('user-table-body').innerHTML = ''; // Kosongkan tabel
    }
}


// -------------------------------------------------------------
// LOGIC STATUS CHECK (Memanggil endpoint ringan)
// -------------------------------------------------------------

async function checkLoginStatus() {
    // Panggil endpoint yang ringan
    try {
        const response = await fetch('/admin/status-check');
        
        if (response.ok) {
            // Berhasil mendapat 200 OK (Session Aktif)
            toggleView(true);
        } else {
            // Menerima 401 Unauthorized (Session Tidak Aktif)
            toggleView(false);
        }
    } catch (error) {
        // Gagal koneksi total ke Express (server mati)
        console.error('Gagal koneksi server saat cek status:', error);
        // Alert ini akan muncul jika server mati saat pertama kali halaman dimuat
        // alert('Gagal koneksi ke server Express. Server mungkin mati.'); 
        toggleView(false); 
    }
}

// -------------------------------------------------------------
// LOGIC LOGIN/REGISTRASI
// -------------------------------------------------------------

document.getElementById('registerForm').addEventListener('submit', handleAdminAuth.bind(null, '/admin/register'));
document.getElementById('loginForm').addEventListener('submit', handleAdminAuth.bind(null, '/admin/login'));

async function handleAdminAuth(endpoint, e) {
    e.preventDefault();
    const isLogin = endpoint === '/admin/login';
    
    // Perbaikan: Ambil nilai dari ID input yang benar
    const email = document.getElementById(isLogin ? 'loginEmail' : 'registerEmail').value;
    const password = document.getElementById(isLogin ? 'loginPassword' : 'registerPassword').value;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            if (isLogin) {
                // Login berhasil, alihkan ke dashboard
                toggleView(true); 
            } else {
                // Registrasi berhasil, alihkan ke Login
                document.getElementById('loginEmail').value = email;
                document.getElementById('loginPassword').value = '';
                toggleForm('login'); // Tampilkan form login
            }
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        // Error ini muncul jika SERVER TIDAK MERESPONS SAMA SEKALI
        alert('Gagal koneksi ke server.'); 
    }
}


// -------------------------------------------------------------
// LOGIC LOGOUT DAN FETCH USERS (Diperlukan untuk Dashboard)
// -------------------------------------------------------------

async function fetchUsers() {
    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = '<tr><td colspan="7">Memuat data...</td></tr>';
    
    try {
        const response = await fetch('/admin/users');
        const result = await response.json();

        tbody.innerHTML = ''; 
        
        if (result.status === 'success' && result.data.length > 0) {
            result.data.forEach(user => {
                const row = tbody.insertRow();
                const expiryDate = new Date(user.expires_at); // Ambil tanggal dari backend
                const isExpired = user.active_status_code === 0; // Menggunakan status code dari backend

                row.insertCell().textContent = user.id;
                row.insertCell().textContent = `${user.first_name} ${user.last_name || ''}`;
                row.insertCell().textContent = user.email;
                row.insertCell().textContent = user.api_key; 
                
                // Tentukan Status Aktif
                row.insertCell().textContent = isExpired ? 'OFF' : 'ON';
                
                // Tentukan Tanggal Kedaluwarsa (Perbaikan Invalid Date)
                row.insertCell().textContent = expiryDate instanceof Date && !isNaN(expiryDate) 
                                                ? expiryDate.toLocaleDateString() 
                                                : 'Invalid Date';
                
                const actionCell = row.insertCell();
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Hapus';
                deleteBtn.className = 'delete-btn';
                deleteBtn.onclick = () => handleDeleteUser(user.id);
                actionCell.appendChild(deleteBtn);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7">Tidak ada user terdaftar.</td></tr>';
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7">Gagal mengambil data user.</td></tr>';
    }
}

async function handleDeleteUser(userId) {
    if (!confirm('Anda yakin ingin menghapus user ini?')) return;
    
    try {
        const response = await fetch(`/admin/users/${userId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            fetchUsers();
        } else {
            alert('Gagal menghapus: ' + result.message);
        }
    } catch (error) {
        alert('Gagal koneksi server saat menghapus.');
    }
}

async function handleLogout() {
    try {
        await fetch('/admin/logout', { method: 'POST' });
        toggleView(false); 
    } catch (error) {
        console.error('Logout error:', error);
    }
}