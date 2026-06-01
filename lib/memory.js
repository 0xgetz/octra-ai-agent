/**
 * Conversation persistence + sharing.
 *
 * An in-memory store with optional JSON-file durability (for the self-hosted
 * server). Supports multiple conversations, message history, branching (fork a
 * conversation from any message), and read-only share links.
 *
 * Serverless note: on ephemeral filesystems (e.g. Vercel) persistence falls back
 * to in-memory only; durability requires a writable PERSIST_DIR.
 */
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

export class MemoryStore {
  constructor({ persistDir = null } = {}) {
    this.persistDir = persistDir;
    /** @type {Map<string, object>} */
    this.conversations = new Map();
    /** @type {Map<string, string>} shareId -> conversationId */
    this.shares = new Map();
    this._writeQueue = Promise.resolve();
  }

  async init() {
    if (!this.persistDir) return;
    try {
      await fs.mkdir(this.persistDir, { recursive: true });
      const file = path.join(this.persistDir, 'conversations.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      for (const c of data.conversations || []) this.conversations.set(c.id, c);
      for (const [sid, cid] of data.shares || []) this.shares.set(sid, cid);
    } catch {
      // No prior state or unreadable — start fresh.
    }
  }

  _persist() {
    if (!this.persistDir) return;
    const snapshot = {
      conversations: [...this.conversations.values()],
      shares: [...this.shares.entries()],
    };
    // Serialize writes to avoid interleaving.
    this._writeQueue = this._writeQueue.then(async () => {
      const file = path.join(this.persistDir, 'conversations.json');
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot));
      await fs.rename(tmp, file);
    }).catch(() => {});
    return this._writeQueue;
  }

  createConversation({ title = 'New conversation', provider = null, model = null } = {}) {
    const now = Date.now();
    const conv = { id: id('conv'), title, provider, model, messages: [], createdAt: now, updatedAt: now, parentId: null };
    this.conversations.set(conv.id, conv);
    this._persist();
    return conv;
  }

  getConversation(cid) {
    return this.conversations.get(cid) || null;
  }

  listConversations() {
    return [...this.conversations.values()]
      .map((c) => ({ id: c.id, title: c.title, provider: c.provider, model: c.model, messageCount: c.messages.length, updatedAt: c.updatedAt, parentId: c.parentId }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  appendMessage(cid, message) {
    const conv = this.conversations.get(cid);
    if (!conv) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') {
      throw Object.assign(new Error('Invalid message'), { status: 400 });
    }
    const entry = { id: id('msg'), role: message.role, content: message.content, ts: Date.now() };
    conv.messages.push(entry);
    conv.updatedAt = entry.ts;
    // Auto-title from first user message.
    if (conv.title === 'New conversation' && message.role === 'user') {
      conv.title = message.content.slice(0, 50) + (message.content.length > 50 ? '…' : '');
    }
    this._persist();
    return entry;
  }

  renameConversation(cid, title) {
    const conv = this.conversations.get(cid);
    if (!conv) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    conv.title = String(title).slice(0, 120);
    conv.updatedAt = Date.now();
    this._persist();
    return conv;
  }

  deleteConversation(cid) {
    const existed = this.conversations.delete(cid);
    for (const [sid, target] of this.shares) if (target === cid) this.shares.delete(sid);
    this._persist();
    return existed;
  }

  /**
   * Branch: create a new conversation containing messages up to and including
   * the given message id (or all messages if not specified).
   */
  branchConversation(cid, fromMessageId = null) {
    const src = this.conversations.get(cid);
    if (!src) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    let slice = src.messages;
    if (fromMessageId) {
      const idx = src.messages.findIndex((m) => m.id === fromMessageId);
      if (idx === -1) throw Object.assign(new Error('Message not found'), { status: 404 });
      slice = src.messages.slice(0, idx + 1);
    }
    const now = Date.now();
    const conv = {
      id: id('conv'),
      title: `${src.title} (branch)`,
      provider: src.provider,
      model: src.model,
      messages: slice.map((m) => ({ ...m, id: id('msg') })),
      createdAt: now,
      updatedAt: now,
      parentId: src.id,
    };
    this.conversations.set(conv.id, conv);
    this._persist();
    return conv;
  }

  createShare(cid) {
    const conv = this.conversations.get(cid);
    if (!conv) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    const shareId = id('share');
    this.shares.set(shareId, cid);
    this._persist();
    return { shareId };
  }

  getShared(shareId) {
    const cid = this.shares.get(shareId);
    if (!cid) return null;
    const conv = this.conversations.get(cid);
    if (!conv) return null;
    return { id: conv.id, title: conv.title, messages: conv.messages, createdAt: conv.createdAt, readOnly: true };
  }

  revokeShare(shareId) {
    const existed = this.shares.delete(shareId);
    this._persist();
    return existed;
  }
}
