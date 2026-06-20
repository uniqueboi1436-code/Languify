const { Server } = require('socket.io');
const { pool } = require('../core/database');
const { UserSession, CommandPacket, LiveIntel } = require('../models');

let io;

function initializeSocketServer(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Operator namespace
  const operatorNamespace = io.of('/operator');
  operatorNamespace.on('connection', (socket) => {
    console.log('Operator connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('Operator disconnected:', socket.id);
    });

    // Handle operator commands
    socket.on('sendCommand', async (data) => {
      try {
        const { sessionId, commandType, payload } = data;

        // Create command packet
        const commandId = require('uuid').v4();
        const commandPacket = new CommandPacket(
          commandId,
          sessionId,
          commandType,
          payload,
          new Date(),
          'sent'
        );

        // Save to database
        await pool.query(
          'INSERT INTO command_packets (command_id, session_id, command_type, payload, status) VALUES ($1, $2, $3, $4, $5)',
          [commandId, sessionId, commandType, JSON.stringify(payload), 'sent']
        );

        // Relay to client
        relayCommand(sessionId, commandPacket);

        socket.emit('commandSent', { commandId, status: 'success' });
      } catch (error) {
        console.error('Error sending command:', error);
        socket.emit('commandError', { error: error.message });
      }
    });

    // Handle live intel requests
    socket.on('requestIntel', async (data) => {
      try {
        const { sessionId } = data;

        const result = await pool.query(
          'SELECT * FROM live_intel WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 50',
          [sessionId]
        );

        socket.emit('intelData', result.rows);
      } catch (error) {
        console.error('Error fetching intel:', error);
        socket.emit('intelError', { error: error.message });
      }
    });
  });

  // Client namespace
  const clientNamespace = io.of('/client');
  clientNamespace.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    let currentSessionId = null;

    socket.on('registerSession', async (data) => {
      try {
        const { deviceId, userAgent, ipAddress } = data;
        const sessionId = require('uuid').v4();

        // Create user session
        const userSession = new UserSession(
          sessionId,
          deviceId,
          userAgent,
          ipAddress,
          new Date(),
          new Date()
        );

        // Save to database
        await pool.query(
          'INSERT INTO user_sessions (session_id, device_id, user_agent, ip_address) VALUES ($1, $2, $3, $4)',
          [sessionId, deviceId, userAgent, ipAddress]
        );

        currentSessionId = sessionId;
        socket.emit('sessionRegistered', { sessionId });

        console.log('Session registered:', sessionId);
      } catch (error) {
        console.error('Error registering session:', error);
        socket.emit('sessionError', { error: error.message });
      }
    });

    socket.on('sendIntel', async (data) => {
      try {
        if (!currentSessionId) {
          socket.emit('intelError', { error: 'No active session' });
          return;
        }

        const { intelType, intelData } = data;
        const intelId = require('uuid').v4();

        // Create live intel
        const liveIntel = new LiveIntel(
          intelId,
          currentSessionId,
          intelType,
          intelData,
          new Date(),
          false
        );

        // Save to database
        await pool.query(
          'INSERT INTO live_intel (intel_id, session_id, intel_type, data) VALUES ($1, $2, $3, $4)',
          [intelId, currentSessionId, intelType, JSON.stringify(intelData)]
        );

        socket.emit('intelSent', { intelId });
      } catch (error) {
        console.error('Error sending intel:', error);
        socket.emit('intelError', { error: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      if (currentSessionId) {
        // Update last activity
        pool.query(
          'UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_id = $1',
          [currentSessionId]
        ).catch(err => console.error('Error updating last activity:', err));
      }
    });
  });

  return io;
}

// Relay command to specific client session
function relayCommand(sessionId, commandPacket) {
  const clientNamespace = io.of('/client');
  clientNamespace.to(sessionId).emit('receiveCommand', {
    commandId: commandPacket.commandId,
    commandType: commandPacket.commandType,
    payload: commandPacket.payload,
    timestamp: commandPacket.timestamp
  });
}

module.exports = {
  initializeSocketServer,
  relayCommand
};
