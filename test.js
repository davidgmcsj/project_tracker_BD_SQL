const { getConnection, sql } = require('./database');

async function testQuery() {
    try {
        const pool = await getConnection();
        const result = await pool.request().query('SELECT GETDATE() as FechaServidor');
        console.log('¡Conexión exitosa!');
        console.log('La fecha del servidor es:', result.recordset[0].FechaServidor);
        await sql.close();
    } catch (error) {
        console.error('La prueba falló:', error);
    }
}

testQuery();