/** Minimal Property List parser (XML and binary bplist00) for IPA Info.plist review. */

export type PlistValue = string | number | boolean | null | PlistValue[] | { [key: string]: PlistValue };

export function parsePlist(buffer: Buffer): PlistValue {
  if (buffer.subarray(0, 6).toString('utf8') === 'bplist') return parseBinaryPlist(buffer);
  const text = buffer.toString('utf8');
  return parseXmlPlist(text);
}

// ---------------------------------------------------------------------------
// XML plist
// ---------------------------------------------------------------------------
function parseXmlPlist(xml: string): PlistValue {
  const dict = /<dict>([\s\S]*)<\/dict>/.exec(xml);
  if (!dict) return {};
  return parseXmlDict(dict[1]);
}

function parseXmlDict(content: string): { [key: string]: PlistValue } {
  const result: { [key: string]: PlistValue } = {};
  const token = /<key>([^<]*)<\/key>\s*(<([a-zA-Z]+)[^>]*?(?:\/>|>([\s\S]*?)<\/\3>))/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(content)) !== null) {
    const key = decodeXml(match[1]);
    result[key] = parseXmlValue(match[3], match[4] ?? '');
  }
  return result;
}

function parseXmlValue(tag: string, inner: string): PlistValue {
  switch (tag) {
    case 'string':
      return decodeXml(inner);
    case 'integer':
      return Number(decodeXml(inner));
    case 'real':
      return Number(decodeXml(inner));
    case 'true':
      return true;
    case 'false':
      return false;
    case 'data':
      return decodeXml(inner);
    case 'array': {
      const values: PlistValue[] = [];
      const element = /<([a-zA-Z]+)[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g;
      let match: RegExpExecArray | null;
      while ((match = element.exec(inner)) !== null) values.push(parseXmlValue(match[1], match[2] ?? ''));
      return values;
    }
    case 'dict':
      return parseXmlDict(inner);
    default:
      return decodeXml(inner) || null;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// ---------------------------------------------------------------------------
// Binary plist
// ---------------------------------------------------------------------------
function parseBinaryPlist(buffer: Buffer): PlistValue {
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer.readUInt8(6);
  const objectRefSize = trailer.readUInt8(7);
  const numObjects = Number(trailer.readBigUInt64BE(8));
  const topObject = Number(trailer.readBigUInt64BE(16));
  const offsetTableOffset = Number(trailer.readBigUInt64BE(24));

  const readUInt = (position: number, size: number): number => {
    let value = 0;
    for (let i = 0; i < size; i += 1) value = value * 256 + buffer.readUInt8(position + i);
    return value;
  };

  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i += 1) offsets.push(readUInt(offsetTableOffset + i * offsetSize, offsetSize));

  const parseObject = (index: number, depth = 0): PlistValue => {
    if (depth > 40 || index >= offsets.length) return null;
    const position = offsets[index];
    const marker = buffer.readUInt8(position);
    const type = marker >> 4;
    const info = marker & 0x0f;
    switch (type) {
      case 0x0:
        if (info === 0x0) return null;
        if (info === 0x8) return false;
        if (info === 0x9) return true;
        return null;
      case 0x1: {
        const size = 1 << info;
        const start = position + 1;
        if (size === 1) return buffer.readInt8(start);
        if (size === 2) return buffer.readInt16BE(start);
        if (size === 4) return buffer.readInt32BE(start);
        return Number(buffer.readBigInt64BE(start));
      }
      case 0x2: {
        const size = 1 << info;
        if (size === 4) return buffer.readFloatBE(position + 1);
        return buffer.readDoubleBE(position + 1);
      }
      case 0x3:
        return new Date(Date.UTC(2001, 0, 1) + buffer.readDoubleBE(position + 1) * 1000).toISOString();
      case 0x4: {
        const length = info === 0x0f ? readUInt(position + 1, 1 << (buffer.readUInt8(position + 1) & 0x0f)) + 2 : info;
        return buffer.subarray(position + 1, position + 1 + length).toString('base64');
      }
      case 0x5: {
        let length = info;
        let start = position + 1;
        if (info === 0x0f) {
          const intMarker = buffer.readUInt8(start);
          const intSize = 1 << (intMarker & 0x0f);
          length = readUInt(start + 1, intSize);
          start = start + 1 + intSize;
        }
        return buffer.subarray(start, start + length).toString('latin1');
      }
      case 0x6: {
        let length = info;
        let start = position + 1;
        if (info === 0x0f) {
          const intMarker = buffer.readUInt8(start);
          const intSize = 1 << (intMarker & 0x0f);
          length = readUInt(start + 1, intSize);
          start = start + 1 + intSize;
        }
        return buffer.subarray(start, start + length * 2).toString('utf16le');
      }
      case 0x8: {
        const length = info === 0x0f ? readUInt(position + 1, 1 << (buffer.readUInt8(position + 1) & 0x0f)) + 2 : info;
        const start = info === 0x0f ? position + 2 + (1 << (buffer.readUInt8(position + 1) & 0x0f)) : position + 1;
        const refs: number[] = [];
        for (let i = 0; i < length; i += 1) refs.push(readUInt(start + i * objectRefSize, objectRefSize));
        return refs.map((ref) => parseObject(ref, depth + 1));
      }
      case 0xa: {
        const length = info === 0x0f ? readUInt(position + 1, 1 << (buffer.readUInt8(position + 1) & 0x0f)) + 2 : info;
        const start = info === 0x0f ? position + 2 + (1 << (buffer.readUInt8(position + 1) & 0x0f)) : position + 1;
        const dict: { [key: string]: PlistValue } = {};
        for (let i = 0; i < length; i += 1) {
          const keyRef = readUInt(start + i * objectRefSize, objectRefSize);
          const valueRef = readUInt(start + (length + i) * objectRefSize, objectRefSize);
          const key = String(parseObject(keyRef, depth + 1) ?? '');
          dict[key] = parseObject(valueRef, depth + 1);
        }
        return dict;
      }
      default:
        return null;
    }
  };

  return parseObject(topObject);
}

export type IosPlistSummary = {
  bundleIdentifier: string | null;
  bundleName: string | null;
  shortVersion: string | null;
  buildVersion: string | null;
  minimumOsVersion: string | null;
  urlSchemes: string[];
  associatedDomains: string[];
  atsAllowsArbitraryLoads: boolean;
  atsExceptionDomains: string[];
  atsMinTls: string | null;
  privacyUsageKeys: string[];
  backgroundModes: string[];
  supportsFileSharing: boolean;
  allowsBackup: boolean;
  entitlements: string[];
  parseErrors: string[];
};

export function summariseInfoPlist(buffer: Buffer): IosPlistSummary {
  const summary: IosPlistSummary = {
    bundleIdentifier: null,
    bundleName: null,
    shortVersion: null,
    buildVersion: null,
    minimumOsVersion: null,
    urlSchemes: [],
    associatedDomains: [],
    atsAllowsArbitraryLoads: false,
    atsExceptionDomains: [],
    atsMinTls: null,
    privacyUsageKeys: [],
    backgroundModes: [],
    supportsFileSharing: false,
    allowsBackup: true,
    entitlements: [],
    parseErrors: [],
  };
  try {
    const value = parsePlist(buffer);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      summary.parseErrors.push('Info.plist could not be parsed as a dictionary');
      return summary;
    }
    const dict = value as { [key: string]: PlistValue };
    summary.bundleIdentifier = typeof dict.CFBundleIdentifier === 'string' ? dict.CFBundleIdentifier : null;
    summary.bundleName = typeof dict.CFBundleDisplayName === 'string' ? dict.CFBundleDisplayName : typeof dict.CFBundleName === 'string' ? dict.CFBundleName : null;
    summary.shortVersion = typeof dict.CFBundleShortVersionString === 'string' ? dict.CFBundleShortVersionString : null;
    summary.buildVersion = typeof dict.CFBundleVersion === 'string' ? dict.CFBundleVersion : null;
    summary.minimumOsVersion = typeof dict.MinimumOSVersion === 'string' ? dict.MinimumOSVersion : null;
    summary.supportsFileSharing = dict.UIFileSharingEnabled === true;
    summary.allowsBackup = dict.UISupportsDocumentBrowser === true ? true : true;

    const urlTypes = (dict.CFBundleURLTypes as PlistValue[]) ?? [];
    for (const entry of Array.isArray(urlTypes) ? urlTypes : []) {
      const schemes = (entry as { CFBundleURLSchemes?: PlistValue[] }).CFBundleURLSchemes ?? [];
      if (Array.isArray(schemes)) summary.urlSchemes.push(...schemes.map(String));
    }
    const domains = dict.CFBundleAssociatedDomains as PlistValue[] | string | undefined;
    if (Array.isArray(domains)) summary.associatedDomains.push(...domains.map(String));
    if (typeof domains === 'string') summary.associatedDomains.push(domains);

    const ats = dict.NSAppTransportSecurity as { [key: string]: PlistValue } | undefined;
    if (ats && typeof ats === 'object') {
      summary.atsAllowsArbitraryLoads = ats.NSAllowsArbitraryLoads === true;
      summary.atsMinTls = typeof ats.NSRequiresCertificateTransparency === 'boolean' ? null : (ats.NSAllowsArbitraryLoadsInWebContent === true ? 'web content exception' : null);
      const exceptionDomains = ats.NSExceptionDomains as { [key: string]: PlistValue } | undefined;
      if (exceptionDomains && typeof exceptionDomains === 'object') summary.atsExceptionDomains.push(...Object.keys(exceptionDomains));
    }

    for (const key of Object.keys(dict)) {
      if (/^NS.*UsageDescription$/.test(key)) summary.privacyUsageKeys.push(key);
    }
    const background = dict.UIBackgroundModes as PlistValue[] | undefined;
    if (Array.isArray(background)) summary.backgroundModes.push(...background.map(String));
  } catch (error) {
    summary.parseErrors.push((error as Error).message);
  }
  return summary;
}
