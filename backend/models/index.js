import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;

export const User = model(
  'User',
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 40 },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      sessionId: { type: String }, // the one valid login for this account
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

export const Room = model(
  'Room',
  new Schema(
    {
      code: { type: String, required: true, unique: true, index: true },
      name: { type: String, required: true, trim: true, maxlength: 60 },
      hostId: { type: Types.ObjectId, ref: 'User', required: true },
      maxMembers: { type: Number, default: 4 },
      memberIds: [{ type: Types.ObjectId, ref: 'User' }],
      lastActiveAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

const sessionSchema = new Schema({
  roomId: { type: Types.ObjectId, ref: 'Room', required: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  participants: [{ userId: Types.ObjectId, name: String }],
  videos: [{ videoId: String, title: String, startedAtT: Number, endedAtT: Number }],
  duration: Number,
  sample: { type: Boolean, default: false },
});
sessionSchema.index({ roomId: 1, startedAt: -1 });
export const PartySession = model('PartySession', sessionSchema);

const chatSchema = new Schema({
  sessionId: { type: Types.ObjectId, ref: 'PartySession', required: true },
  userId: { type: Types.ObjectId, ref: 'User', required: true },
  name: String,
  text: { type: String, required: true, maxlength: 500 },
  videoId: String,
  t: Number,
  createdAt: { type: Date, default: Date.now },
});
chatSchema.index({ sessionId: 1, createdAt: 1 });
export const ChatMessage = model('ChatMessage', chatSchema);

const reactionSchema = new Schema({
  sessionId: { type: Types.ObjectId, ref: 'PartySession', required: true },
  userId: { type: Types.ObjectId, ref: 'User' },
  kind: { type: String, enum: ['laugh', 'smile', 'surprise', 'emoji'], required: true },
  emoji: String,
  videoId: String,
  t: { type: Number, required: true },
  strength: { type: Number, min: 0, max: 1, default: 0 },
  source: { type: String, enum: ['auto', 'manual', 'seed'], default: 'auto' },
});
reactionSchema.index({ sessionId: 1, videoId: 1, t: 1 });
export const ReactionEvent = model('ReactionEvent', reactionSchema);

export const GameRound = model(
  'GameRound',
  new Schema({
    sessionId: { type: Types.ObjectId, ref: 'PartySession', required: true },
    videoId: String,
    config: { baselineSec: Number, smileThreshold: Number, holdFrames: Number },
    startedAt: Date,
    endedAt: Date,
    outcomes: [{ userId: Types.ObjectId, name: String, outAtT: Number, peak: Number }],
    winners: [{ type: Types.ObjectId, ref: 'User' }],
  }),
);
