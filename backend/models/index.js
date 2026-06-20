// Universal Data Structures

// UserSession Interface
class UserSession {
  constructor(sessionId, deviceId, userAgent, ipAddress, createdAt, lastActivity) {
    this.sessionId = sessionId;
    this.deviceId = deviceId;
    this.userAgent = userAgent;
    this.ipAddress = ipAddress;
    this.createdAt = createdAt;
    this.lastActivity = lastActivity;
  }
}

// CommandPacket Interface
class CommandPacket {
  constructor(commandId, sessionId, commandType, payload, timestamp, status) {
    this.commandId = commandId;
    this.sessionId = sessionId;
    this.commandType = commandType;
    this.payload = payload;
    this.timestamp = timestamp;
    this.status = status;
  }
}

// LiveIntel Interface
class LiveIntel {
  constructor(intelId, sessionId, intelType, data, timestamp, processed) {
    this.intelId = intelId;
    this.sessionId = sessionId;
    this.intelType = intelType;
    this.data = data;
    this.timestamp = timestamp;
    this.processed = processed;
  }
}

module.exports = {
  UserSession,
  CommandPacket,
  LiveIntel
};
