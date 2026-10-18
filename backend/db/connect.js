import mongoose from 'mongoose';

export async function connectDb(url, dbName) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000, ...(dbName ? { dbName } : {}) });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
