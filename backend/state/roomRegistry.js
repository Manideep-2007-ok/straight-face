// In-memory live rooms. Single process, so each method runs to completion
// without interleaving; the capacity check and the add happen in one block.
export class RoomRegistry {
  constructor(maxMembers = 4) {
    this.maxMembers = maxMembers;
    this.rooms = new Map(); // code -> { members: Map<userId, {userId,name,socketId}> }
  }

  memberCount(code) {
    return this.rooms.get(code)?.members.size ?? 0;
  }

  members(code) {
    return [...(this.rooms.get(code)?.members.values() ?? [])];
  }

  // Returns { ok:true, member } or { ok:false, error:'ROOM_FULL' }.
  // The same user rejoining (second tab/reconnect) replaces their old entry
  // instead of taking a second seat.
  join(code, user, socketId) {
    let room = this.rooms.get(code);
    if (!room) {
      room = { members: new Map() };
      this.rooms.set(code, room);
    }
    const already = room.members.has(user.userId);
    if (!already && room.members.size >= this.maxMembers) return { ok: false, error: 'ROOM_FULL' };
    const member = { userId: user.userId, name: user.name, socketId };
    room.members.set(user.userId, member);
    return { ok: true, member };
  }

  // Only removes if socketId still owns the seat (a newer tab may have replaced it).
  leave(code, userId, socketId) {
    const room = this.rooms.get(code);
    if (!room) return false;
    const m = room.members.get(userId);
    if (!m || m.socketId !== socketId) return false;
    room.members.delete(userId);
    if (room.members.size === 0) this.rooms.delete(code);
    return true;
  }
}
