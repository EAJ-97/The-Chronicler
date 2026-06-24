const crypto = require('crypto');

const AUTH_URL = 'https://auth-service.dndbeyond.com/v1/cobalt-token';
const CHARACTER_BASE = 'https://character-service.dndbeyond.com/character/v5';

/** In-memory JWT cache keyed by SHA-256 of cobalt (process lifetime only). */
const tokenCache = new Map();

/** @type {Map<string, string|null>} userId cached per cobalt hash from auth response or JWT */
const userIdCache = new Map();

const BROWSER_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * Hashes a cobalt session for cache keys without storing the raw value in the cache map key beyond lookup.
 * @param {string} cobalt
 * @returns {string}
 */
function cacheIdFor(cobalt) {
  return crypto.createHash('sha256').update(String(cobalt)).digest('hex');
}

/**
 * Decodes a JWT payload without verification (DDB token is only used upstream).
 * @param {string} token
 * @returns {object|null}
 */
function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    try {
      const parts = String(token).split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
}

/**
 * Extracts D&D Beyond user id from cobalt JWT payload (legacy helper).
 * @param {string} token
 * @returns {number|null}
 */
function userIdFromToken(token) {
  return userIdFromAuthData(null, token);
}

/**
 * Exchanges CobaltSession for a bearer JWT; caches by hashed cobalt.
 * @param {string} [cobalt]
 * @returns {Promise<string|null>}
 */
async function getBearerToken(cobalt) {
  const trimmed = String(cobalt || '').trim();
  if (!trimmed) return null;

  const cacheKey = cacheIdFor(trimmed);
  if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      Cookie: `CobaltSession=${trimmed}`,
    },
  });

  if (!res.ok) {
    const err = new Error('Invalid or expired D&D Beyond session');
    err.code = 'DDB_AUTH';
    throw err;
  }

  const data = await res.json();
  const token = data?.token;
  if (!token || typeof token !== 'string') {
    const err = new Error('Invalid or expired D&D Beyond session');
    err.code = 'DDB_AUTH';
    throw err;
  }

  const userId = userIdFromAuthData(data, token);
  tokenCache.set(cacheKey, token);
  userIdCache.set(cacheKey, userId);
  return token;
}

/**
 * Builds fetch headers for character-service calls.
 * @param {string|null} bearer
 * @param {string} [cobalt]
 * @param {string|number|null} [userIdCookie] - Optional User.ID cookie value for DDB list APIs
 * @returns {Record<string, string>}
 */
function ddbHeaders(bearer, cobalt, userIdCookie) {
  const headers = { ...BROWSER_HEADERS };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const cookies = [];
  const trimmed = String(cobalt || '').trim();
  if (trimmed) cookies.push(`CobaltSession=${trimmed}`);
  if (userIdCookie != null && String(userIdCookie).trim()) {
    cookies.push(`User.ID=${String(userIdCookie).trim()}`);
  }
  if (cookies.length) headers.Cookie = cookies.join('; ');
  return headers;
}

/**
 * Parses D&D Beyond user id from auth JSON or JWT (numeric or GUID).
 * @param {object|null} authData - Body from POST cobalt-token
 * @param {string|null} token - Bearer JWT
 * @returns {string|null}
 */
function userIdFromAuthData(authData, token) {
  const direct = authData?.userId ?? authData?.UserId ?? authData?.user_id ?? authData?.id;
  if (direct != null && String(direct).trim()) return String(direct).trim();

  const payload = token ? decodeJwtPayload(token) : null;
  if (payload) {
    const keys = [
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
      'userId', 'UserId', 'user_id', 'sub', 'nameid', 'id',
    ];
    for (const key of keys) {
      const raw = payload[key];
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }
  }
  return null;
}

/**
 * Extracts character rows from assorted DDB list API response shapes.
 * @param {object|null} json
 * @returns {Array<object>}
 */
function extractCharacterListRows(json) {
  if (!json) return [];
  if (Array.isArray(json?.data?.characters)) return json.data.characters;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.characters)) return json.characters;
  if (Array.isArray(json)) return json;
  return [];
}

/**
 * Fetches the account user id from D&D Beyond profile endpoints when not in the JWT.
 * @param {string} bearer
 * @param {string} cobalt
 * @param {string|number|null} [userIdCookie]
 * @returns {Promise<string|null>}
 */
async function fetchUserIdFromProfile(bearer, cobalt, userIdCookie) {
  const urls = [
    'https://www.dndbeyond.com/api/user/v1/user',
    'https://www.dndbeyond.com/api/user/v1/current-user',
    'https://www.dndbeyond.com/api/user',
    'https://www.dndbeyond.com/api/profile/v1/user',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: ddbHeaders(bearer, cobalt, userIdCookie) });
      if (!res.ok) continue;
      const json = await res.json();
      const raw =
        json?.id ?? json?.data?.id ?? json?.userId ?? json?.data?.userId
        ?? json?.user?.id ?? json?.data?.user?.id;
      if (raw != null && String(raw).trim()) return String(raw).trim();
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Resolves D&D Beyond user id for character list APIs.
 * @param {string} cobalt
 * @param {string} bearer
 * @param {string|number|null|undefined} explicitUserId - Optional override from client
 * @returns {Promise<string|null>}
 */
async function resolveUserId(cobalt, bearer, explicitUserId) {
  const cacheKey = cacheIdFor(cobalt);
  const explicit = String(explicitUserId ?? '').trim();
  if (explicit) {
    userIdCache.set(cacheKey, explicit);
    return explicit;
  }

  const cached = userIdCache.get(cacheKey);
  if (cached) return cached;

  const fromProfile = await fetchUserIdFromProfile(bearer, cobalt, explicitUserId);
  if (fromProfile) {
    userIdCache.set(cacheKey, fromProfile);
    return fromProfile;
  }

  return userIdCache.get(cacheKey) ?? null;
}

/**
 * Validates cobalt and optionally resolves account user id from D&D Beyond profile APIs.
 * @param {string} cobalt
 * @param {string|number|null|undefined} [explicitUserId]
 * @returns {Promise<{ ok: true, user_id: string|null }>}
 */
async function testCobalt(cobalt, explicitUserId) {
  const trimmed = String(cobalt || '').trim();
  const bearer = await getBearerToken(trimmed);
  const userId = await resolveUserId(trimmed, bearer, explicitUserId);
  return { ok: true, user_id: userId };
}

/**
 * Lists characters for the authenticated D&D Beyond account.
 * @param {string} cobalt
 * @param {string|number|null|undefined} [explicitUserId] - User.ID cookie value when JWT lacks user id
 * @returns {Promise<Array<{ id: number, name: string, level: number|null, classSummary: string, race: string }>>}
 */
async function listCharacters(cobalt, explicitUserId) {
  const trimmed = String(cobalt || '').trim();
  if (!trimmed) {
    const err = new Error('Cobalt cookie is required to list characters');
    err.code = 'DDB_NO_COBALT';
    throw err;
  }

  const bearer = await getBearerToken(trimmed);
  let userId = await resolveUserId(trimmed, bearer, explicitUserId);

  const listUrls = [];
  if (userId) {
    listUrls.push(`${CHARACTER_BASE}/characters/list?userId=${encodeURIComponent(userId)}`);
  }

  let json = null;
  let lastStatus = 0;
  for (const url of listUrls) {
    const res = await fetch(url, { headers: ddbHeaders(bearer, trimmed, explicitUserId ?? userId) });
    lastStatus = res.status;
    if (!res.ok) continue;
    json = await res.json();
    break;
  }

  const rows = extractCharacterListRows(json);
  if (!rows.length && !json) {
    const err = new Error(
      userId
        ? 'Failed to list D&D Beyond characters'
        : 'Character list unavailable — paste your character URL above to import.'
    );
    err.code = lastStatus === 403 ? 'DDB_FORBIDDEN' : 'DDB_AUTH';
    throw err;
  }

  return rows.map((row) => {
    const id = parseInt(row.id ?? row.characterId, 10);
    const classes = row.classes || row.classNames || [];
    let classSummary = row.classDescription || '';
    if (!classSummary && Array.isArray(classes)) {
      classSummary = classes
        .map((c) => (typeof c === 'string' ? c : c?.name || c?.definition?.name || ''))
        .filter(Boolean)
        .join(' / ');
    } else if (!classSummary && typeof classes === 'string') {
      classSummary = classes;
    }

    return {
      id,
      name: row.name || row.characterName || 'Unnamed',
      level: row.level ?? row.totalLevel ?? null,
      classSummary,
      race: row.raceName || row.race || row.race?.name || '',
    };
  }).filter((c) => Number.isFinite(c.id));
}

/**
 * Fetches raw v5 character JSON from D&D Beyond.
 * @param {string|undefined|null} cobalt - Optional; required for private characters.
 * @param {number} characterId
 * @returns {Promise<object>}
 */
async function fetchCharacter(cobalt, characterId) {
  const id = parseInt(characterId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Invalid character id');
    err.code = 'DDB_BAD_ID';
    throw err;
  }

  const trimmed = String(cobalt || '').trim();
  let bearer = null;
  if (trimmed) {
    bearer = await getBearerToken(trimmed);
  }

  const url = `${CHARACTER_BASE}/character/${id}?includeCustomItems=true&_=${Date.now()}`;
  const res = await fetch(url, { headers: ddbHeaders(bearer, trimmed) });

  if (res.status === 403 || res.status === 401) {
    const err = new Error(
      'Character is private or session expired. Set the character to Public on D&D Beyond, or connect with your Cobalt cookie.'
    );
    err.code = 'DDB_FORBIDDEN';
    throw err;
  }
  if (res.status === 404) {
    const err = new Error('Character not found on D&D Beyond');
    err.code = 'DDB_NOT_FOUND';
    throw err;
  }
  if (!res.ok) {
    const err = new Error('Failed to fetch character from D&D Beyond');
    err.code = 'DDB_UPSTREAM';
    throw err;
  }

  const json = await res.json();
  if (json?.success === false) {
    const err = new Error(json.message || 'D&D Beyond returned an error');
    err.code = 'DDB_FORBIDDEN';
    throw err;
  }

  const data = json?.data ?? json;
  if (!data || typeof data !== 'object') {
    const err = new Error('Unexpected response from D&D Beyond');
    err.code = 'DDB_UPSTREAM';
    throw err;
  }

  return data;
}

/**
 * Parses a D&D Beyond character URL or numeric id string.
 * @param {string} input
 * @returns {number|null}
 */
function parseCharacterId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/characters\/(\d+)/i) || s.match(/^(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = {
  getBearerToken,
  testCobalt,
  listCharacters,
  fetchCharacter,
  parseCharacterId,
};
