const sql = require('mssql');

const config = {
    user: 'project_tracker', // El usuario que creaste
    password: 'David..2248098', // La contraseña que pusiste
    server: 'localhost', 
    database: 'DB_SeguimientoProyectos',
    options: {
        encrypt: false, // Ponlo en false si es local
        trustServerCertificate: true // Necesario para desarrollo local
    }
};

async function getConnection() {
    try {
        const pool = await sql.connect(config);
        return pool;
    } catch (error) {
        console.error('Error de conexión a la base de datos:', error);
    }
}

module.exports = {
    sql,
    getConnection
};