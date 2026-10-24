// Video queue with votes. Pure functions; items are { id, videoId, title, addedBy, addedByName, voters: [userId] }.
export const MAX_QUEUE = 20;

export function addItem(queue, { videoId, title, userId, name }, id) {
  if (queue.length >= MAX_QUEUE) return { queue, error: 'QUEUE_FULL' };
  if (queue.some((q) => q.videoId === videoId)) return { queue, error: 'ALREADY_QUEUED' };
  const item = { id, videoId, title: title || `Video ${videoId}`, addedBy: userId, addedByName: name, voters: [userId] };
  return { queue: [...queue, item], item };
}

// Toggle: voting again removes your vote.
export function toggleVote(queue, id, userId) {
  if (!queue.some((q) => q.id === id)) return { queue, error: 'NOT_FOUND' };
  return {
    queue: queue.map((q) => {
      if (q.id !== id) return q;
      const has = q.voters.includes(userId);
      return { ...q, voters: has ? q.voters.filter((v) => v !== userId) : [...q.voters, userId] };
    }),
  };
}

// Most votes first; ties keep the order they were added in.
export function ranked(queue) {
  return queue.map((q, i) => ({ q, i })).sort((a, b) => b.q.voters.length - a.q.voters.length || a.i - b.i).map((x) => x.q);
}

export function popNext(queue) {
  if (!queue.length) return { queue, next: null };
  const [next, ...rest] = ranked(queue);
  return { queue: rest, next };
}

export const publicQueue = (queue) =>
  ranked(queue).map((q) => ({ id: q.id, videoId: q.videoId, title: q.title, addedByName: q.addedByName, votes: q.voters.length, voters: q.voters }));
