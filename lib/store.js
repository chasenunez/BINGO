/**
 * lib/store.js
 *
 * Simple file-based encrypted store. Stores a single JSON object:
 * {
 *   users: [ { id, name, email, passwordHash, board, createdAt,
 *              displayName, isAnonymous, wonAt, deletedAt } ],
 *   sessions: { sid: userId, ... },
 *   winners: [ { id, userId, displayName, snapshot, createdAt } ]
 * }
 *
 * Encryption: AES-256-GCM using Node crypto. secretKey must be at least 32 characters.
 *
 * NOTE: This is intended for small deployments / local use.
 */

// Anonymous-name word lists. Adjectives are vetted to be non-explicit and friendly.
const ADJECTIVES = [
  'Cool', 'Fancy', 'Brave', 'Clever', 'Mighty', 'Swift', 'Quiet', 'Bright', 'Gentle', 'Jolly',
  'Lucky', 'Witty', 'Happy', 'Eager', 'Calm', 'Bold', 'Curious', 'Friendly', 'Kind', 'Wise',
  'Sunny', 'Plucky', 'Nifty', 'Sleepy', 'Sparkly', 'Cheerful', 'Dapper', 'Chipper', 'Zesty', 'Snazzy',
  'Mellow', 'Peppy', 'Bouncy', 'Fluffy', 'Cosmic', 'Stellar', 'Velvet', 'Crimson', 'Golden', 'Silver',
  'Emerald', 'Sapphire', 'Amber', 'Ivory', 'Mystic', 'Noble', 'Regal', 'Royal', 'Daring', 'Fearless',
  'Gallant', 'Heroic', 'Nimble', 'Spry', 'Spirited', 'Vibrant', 'Radiant', 'Glowing', 'Twinkling', 'Dancing',
  'Whimsical', 'Quirky', 'Zany', 'Breezy', 'Frosty', 'Toasty', 'Fuzzy', 'Sneaky', 'Crafty', 'Tidy',
  'Cozy', 'Snug', 'Speedy', 'Zooming', 'Galactic', 'Lunar', 'Solar', 'Cloudy', 'Misty', 'Rainy',
  'Smiling', 'Laughing', 'Singing', 'Humming', 'Whistling', 'Grinning', 'Beaming', 'Glistening', 'Shimmering', 'Sparkling',
  'Marvelous', 'Splendid', 'Dazzling', 'Charming', 'Delightful', 'Wonderful', 'Magical', 'Enchanted', 'Mighty', 'Hearty'
];

const ANIMALS = [
  'Alphorn', 'Taco Cat', 'Rave Crab', 'Pfifolter',
  'Ibex', 'Hündli', 'Marronitschtand','Marroniverchäufer','Näbel', 'Rägebog',
  'Eechhörnli', 'Bär', 'Bärg', 'Chüeh', 'Vögeli', 'Blüemli', 'Bratwurscht', 'Brüederli', 'Fötzeli', 'Füürwärk','Bütschgi', 'Glöggliböögg', 'Guetzli',
  'Crocodile', 'Wombat', 'Otter', 'Penguin', 'Panda', 'Koala', 'Falcon', 'Hedgehog', 'Badger', 'Capybara',
  'Lemur', 'Sloth', 'Octopus', 'Dolphin', 'Walrus', 'Manatee', 'Narwhal', 'Beaver', 'Raccoon', 'Squirrel',
  'Chipmunk', 'Rabbit', 'Hare', 'Fox', 'Wolf', 'Bear', 'Moose', 'Elk', 'Reindeer', 'Bison',
  'Buffalo', 'Yak', 'Llama', 'Alpaca', 'Camel', 'Giraffe', 'Zebra', 'Hippo', 'Rhino', 'Elephant',
  'Tiger', 'Lion', 'Cheetah', 'Leopard', 'Jaguar', 'Lynx', 'Bobcat', 'Cougar', 'Panther', 'Ocelot',
  'Eagle', 'Hawk', 'Owl', 'Heron', 'Crane', 'Pelican', 'Flamingo', 'Toucan', 'Parrot', 'Macaw',
  'Puffin', 'Albatross', 'Swan', 'Goose', 'Duck', 'Quail', 'Pheasant', 'Peacock', 'Robin', 'Sparrow',
  'Finch', 'Cardinal', 'Bluejay', 'Magpie', 'Raven', 'Crow', 'Dove', 'Pigeon', 'Hummingbird', 'Kingfisher',
  'Salamander', 'Newt', 'Frog', 'Toad', 'Turtle', 'Tortoise', 'Iguana', 'Gecko', 'Chameleon', 'Komodo',
  'Mongoose', 'Meerkat', 'Aardvark', 'Anteater', 'Armadillo', 'Pangolin', 'Tapir', 'Okapi', 'Kangaroo', 'Wallaby'
];

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor({ filePath, secretKey }) {
    this.filePath = filePath;
    this.secretKey = secretKey;
    if (typeof secretKey !== 'string' || secretKey.length < 32) {
      throw new Error('secretKey must be a string at least 32 characters long');
    }
    this._data = {
      users: [],
      sessions: {},
      winners: []
    };
  }

  async init() {
    // ensure directory exists
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // if file exists, load
    try {
      const enc = await fs.readFile(this.filePath);
      const json = Store._decrypt(enc, this.secretKey);
      this._data = JSON.parse(json);
      // sanity: ensure arrays exist
      this._data.users = this._data.users || [];
      this._data.sessions = this._data.sessions || {};
      this._data.winners = this._data.winners || [];
    } catch (err) {
      // file probably doesn't exist -> create initial encrypted store
      await this.save();
    }
  }

  static _encrypt(plainText, secretKey) {
    const key = crypto.createHash('sha256').update(secretKey).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // store as iv + tag + ciphertext
    return Buffer.concat([iv, tag, encrypted]);
  }

  static _decrypt(buffer, secretKey) {
    const key = crypto.createHash('sha256').update(secretKey).digest();
    const iv = buffer.slice(0, 12);
    const tag = buffer.slice(12, 28);
    const ciphertext = buffer.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  async save() {
    const json = JSON.stringify(this._data, null, 2);
    const enc = Store._encrypt(json, this.secretKey);
    await fs.writeFile(this.filePath, enc);
  }

  // 25 bingo task phrases in board order (positions 0-24)
  // Board order by task number: 9,22,24,2,13,17,25,21,16,15,4,3,1,5,6,23,14,12,7,19,11,8,18,20,10
  defaultPhrases() {
    return [
      "Publish your data online",                       // Task 9
      "Create a requirements file",                     // Task 22
      "Use a virtual or containerized environment",     // Task 24
      "Store your data in an open format",              // Task 2
      "Organize your repo in a logical structure",      // Task 13
      "Post your repo/code to social media",            // Task 17
      "Create and customize a .gitignore file",         // Task 25
      "Publish a reproducible visualization",    // Task 21
      "Refactor a function to be more reusable",        // Task 16
      "Document your environment",                      // Task 15
      "Separate rawdata from processed data",           // Task 4
      "Give your files understandable names",           // Task 3
      "Add a README",                                   // Task 1
      "Create a metadata file",                         // Task 5
      "Organize files in logical folder structure",     // Task 6
      "Collaborate on a code repository",               // Task 23
      "Setup a git repository and make a first commit", // Task 14
      "Link data to publication",                       // Task 12
      "Use a field-specific resource",         // Task 7
      "Publish data/code to supported infrastructure",  // Task 19
      "Use meaningful variable naming",                 // Task 11
      "Add a license",                                  // Task 8
      "Write a unit test for your code",                // Task 18
      "Adapt an existing project/code using a fork",    // Task 20
      "(re)Comment your code"                           // Task 10
    ];
  }

  getUserByEmail(email) {
    return this._data.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  }

  addUser(user) {
    this._data.users.push(user);
  }

  updateUser(user) {
    const idx = this._data.users.findIndex(u => u.id === user.id);
    if (idx >= 0) this._data.users[idx] = user;
  }

  // sessions: sid -> userId
  createSessionForUser(userId) {
    const sid = crypto.randomBytes(16).toString('hex');
    this._data.sessions[sid] = { userId, createdAt: new Date().toISOString() };
    return sid;
  }

  getUserBySession(sid) {
    const s = this._data.sessions[sid];
    if (!s) return null;
    return this._data.users.find(u => u.id === s.userId) || null;
  }

  destroySession(sid) {
    delete this._data.sessions[sid];
  }

  addWinner(w) {
    // remove any existing winners for same userId
    if (w && w.userId) {
      this._data.winners = this._data.winners.filter(existing => existing.userId !== w.userId);
    }
    // add new winner at the front
    this._data.winners.unshift(w);
    // keep recent 100 winners
    this._data.winners = this._data.winners.slice(0, 100);
  }

  getWinners() {
    // Filter out winners belonging to deleted users. For anonymous users,
    // strip evidence URLs and descriptions from the snapshot so their wins
    // cannot be traced back to them — but preserve a `filled` flag per cell
    // so the visual pattern of completed squares still renders on the
    // winners page.
    const deletedUserIds = new Set(
      this._data.users.filter(u => u.deletedAt).map(u => u.id)
    );
    const usersById = new Map(this._data.users.map(u => [u.id, u]));
    return this._data.winners
      .filter(w => !deletedUserIds.has(w.userId))
      .map(w => {
        const user = usersById.get(w.userId);
        const isAnonymous = !!(user && user.isAnonymous);
        if (!isAnonymous) return w;
        const snapshot = (w.snapshot || []).map(cell => ({
          phrase: cell && cell.phrase ? cell.phrase : '',
          filled: !!(cell && cell.url),
          url: null,
          description: null
        }));
        return Object.assign({}, w, { snapshot, anonymous: true });
      });
  }

  // Generate a unique ADJECTIVE ANIMAL name not currently in use by any user
  // (active or deleted) to ensure permanent uniqueness.
  generateAnonymousName() {
    const used = new Set(
      this._data.users
        .map(u => (u.displayName || '').toUpperCase())
        .filter(n => n.length > 0)
    );
    const maxAttempts = 500;
    for (let i = 0; i < maxAttempts; i++) {
      const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
      const candidate = `${adj.toUpperCase()} ${animal.toUpperCase()}`;
      if (!used.has(candidate)) return candidate;
    }
    // Fallback: append a numeric suffix
    const adj = ADJECTIVES[0].toUpperCase();
    const animal = ANIMALS[0].toUpperCase();
    let n = 2;
    while (used.has(`${adj} ${animal} ${n}`)) n++;
    return `${adj} ${animal} ${n}`;
  }

  // Admin helpers
  getAllUsersForAdmin() {
    return this._data.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      displayName: u.displayName || u.name,
      isAnonymous: !!u.isAnonymous,
      createdAt: u.createdAt,
      wonAt: u.wonAt || null,
      deletedAt: u.deletedAt || null
    }));
  }

  // Mark a user as deleted (soft delete) and remove them from the winners list.
  // We retain the user record so admins can audit who was removed and when.
  markUserDeleted(userId) {
    const user = this._data.users.find(u => u.id === userId);
    if (!user) return false;
    user.deletedAt = new Date().toISOString();
    // Wipe sensitive fields on deletion
    user.passwordHash = null;
    user.board = [];
    // Remove their winner entry
    this._data.winners = this._data.winners.filter(w => w.userId !== userId);
    // Destroy any active sessions for this user
    for (const sid of Object.keys(this._data.sessions)) {
      if (this._data.sessions[sid].userId === userId) {
        delete this._data.sessions[sid];
      }
    }
    return true;
  }

  setUserWonAt(userId, ts) {
    const user = this._data.users.find(u => u.id === userId);
    if (user) user.wonAt = ts;
  }
}

module.exports = Store;
