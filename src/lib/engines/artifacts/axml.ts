/**
 * Android binary XML (AXML) parser for AndroidManifest.xml.
 *
 * Implements the chunk format used by AAPT/AAPT2: string pool, resource map
 * and start/end element chunks. Only the information required for security
 * review is extracted (package identity, permissions, exported components,
 * application flags and deep-link schemes).
 */

export type AndroidComponent = {
  type: 'activity' | 'service' | 'receiver' | 'provider';
  name: string;
  exported: boolean | null;
  intentFilters: { actions: string[]; schemes: string[]; hosts: string[]; autoVerify: boolean }[];
  permission: string | null;
};

export type AndroidManifest = {
  packageName: string | null;
  versionName: string | null;
  versionCode: string | null;
  minSdk: string | null;
  targetSdk: string | null;
  permissions: string[];
  customPermissions: string[];
  application: {
    debuggable: boolean;
    allowBackup: boolean | null;
    usesCleartextTraffic: boolean | null;
    networkSecurityConfig: string | null;
    label: string | null;
    requestLegacyExternalStorage: boolean;
  };
  components: AndroidComponent[];
  parseErrors: string[];
};

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

class Reader {
  offset = 0;
  constructor(private readonly buffer: Buffer) {}
  u8() { const v = this.buffer.readUInt8(this.offset); this.offset += 1; return v; }
  u16() { const v = this.buffer.readUInt16LE(this.offset); this.offset += 2; return v; }
  u32() { const v = this.buffer.readUInt32LE(this.offset); this.offset += 4; return v; }
  skip(n: number) { this.offset += n; }
  remaining() { return this.buffer.length - this.offset; }
}

function readStringPool(buffer: Buffer, start: number): { strings: string[]; end: number } {
  const reader = new Reader(buffer);
  reader.offset = start;
  reader.u16(); // type
  reader.u16(); // header size
  const chunkSize = reader.u32();
  const stringCount = reader.u32();
  const styleCount = reader.u32();
  const flags = reader.u32();
  const stringsStart = reader.u32();
  reader.u32(); // stylesStart
  const offsets: number[] = [];
  for (let i = 0; i < stringCount; i += 1) offsets.push(reader.u32());
  const isUtf8 = (flags & 0x100) !== 0;
  const strings: string[] = [];
  for (const relative of offsets) {
    const position = start + stringsStart + relative;
    if (position >= buffer.length) {
      strings.push('');
      continue;
    }
    const stringReader = new Reader(buffer);
    stringReader.offset = position;
    try {
      if (isUtf8) {
        let length = stringReader.u8();
        if (length & 0x80) length = ((length & 0x7f) << 8) | stringReader.u8();
        let byteLength = stringReader.u8();
        if (byteLength & 0x80) byteLength = ((byteLength & 0x7f) << 8) | stringReader.u8();
        strings.push(buffer.subarray(stringReader.offset, stringReader.offset + byteLength).toString('utf8'));
      } else {
        let length = stringReader.u16();
        if (length & 0x8000) length = ((length & 0x7fff) << 16) | stringReader.u16();
        strings.push(buffer.subarray(stringReader.offset, stringReader.offset + length * 2).toString('utf16le'));
      }
    } catch {
      strings.push('');
    }
  }
  return { strings, end: start + chunkSize };
}

type ParsedAttribute = { namespace: string | null; name: string; value: string | number | boolean | null; rawValue: string | null };

export function parseAndroidManifest(buffer: Buffer): AndroidManifest {
  const manifest: AndroidManifest = {
    packageName: null,
    versionName: null,
    versionCode: null,
    minSdk: null,
    targetSdk: null,
    permissions: [],
    customPermissions: [],
    application: {
      debuggable: false,
      allowBackup: null,
      usesCleartextTraffic: null,
      networkSecurityConfig: null,
      label: null,
      requestLegacyExternalStorage: false,
    },
    components: [],
    parseErrors: [],
  };

  // Some builds ship a plain-text manifest (rare, e.g. debug builds).
  const head = buffer.subarray(0, 64).toString('utf8');
  if (head.includes('<?xml') || head.includes('<manifest')) {
    return parsePlainManifest(buffer.toString('utf8'));
  }

  let strings: string[] = [];
  let applicationOpen = false;
  let currentComponent: AndroidComponent | null = null;
  let currentFilter: AndroidComponent['intentFilters'][number] | null = null;
  let lastStartTag: string | null = null;
  const elementStack: string[] = [];

  try {
    let offset = 8; // skip file header (type + header size)
    while (offset < buffer.length - 8) {
      const reader = new Reader(buffer);
      reader.offset = offset;
      const type = reader.u16();
      const headerSize = reader.u16();
      const chunkSize = reader.u32();
      if (chunkSize <= 0 || offset + chunkSize > buffer.length + 8) break;

      if (type === 0x0001) {
        const pool = readStringPool(buffer, offset);
        strings = pool.strings;
      } else if (type === 0x0102) {
        // START_ELEMENT
        reader.offset = offset + headerSize;
        reader.u32(); // lineNumber
        reader.u32(); // comment
        reader.u32(); // namespace
        const nameIndex = reader.u32();
        const name = strings[nameIndex] ?? '';
        const attributeStart = reader.u16();
        const attributeSize = reader.u16();
        const attributeCount = reader.u16();
        reader.skip(6);
        const attributes: ParsedAttribute[] = [];
        let attributeOffset = offset + headerSize + attributeStart;
        for (let i = 0; i < attributeCount; i += 1) {
          const attrReader = new Reader(buffer);
          attrReader.offset = attributeOffset;
          const ns = attrReader.u32();
          const attrName = attrReader.u32();
          const rawValue = attrReader.u32();
          attrReader.u16(); // size
          attrReader.u8(); // res0
          const dataType = attrReader.u8();
          const data = attrReader.u32();
          let value: string | number | boolean | null = null;
          if (dataType === 0x03) value = strings[data] ?? '';
          else if (dataType === 0x12) value = data !== 0;
          else if (dataType === 0x10 || dataType === 0x11) value = data;
          else if (dataType === 0x01) value = `@ref/0x${data.toString(16)}`;
          attributes.push({
            namespace: ns === 0xffffffff ? null : strings[ns] ?? null,
            name: strings[attrName] ?? '',
            value,
            rawValue: rawValue === 0xffffffff ? null : strings[rawValue] ?? null,
          });
          attributeOffset += attributeSize;
        }
        const attr = (name: string): ParsedAttribute | undefined =>
          attributes.find((a) => a.name === name && (a.namespace === ANDROID_NS || a.namespace === null));

        lastStartTag = name;
        elementStack.push(name);
        if (name === 'manifest') {
          manifest.packageName = String(attr('package')?.value ?? '') || null;
          manifest.versionName = String(attr('versionName')?.value ?? '') || null;
          manifest.versionCode = String(attr('versionCode')?.value ?? '') || null;
        } else if (name === 'uses-sdk') {
          manifest.minSdk = String(attr('minSdkVersion')?.value ?? '') || null;
          manifest.targetSdk = String(attr('targetSdkVersion')?.value ?? '') || null;
        } else if (name === 'uses-permission' || name === 'uses-permission-sdk-23') {
          const permission = String(attr('name')?.value ?? '');
          if (permission) manifest.permissions.push(permission);
        } else if (name === 'permission') {
          const permission = String(attr('name')?.value ?? '');
          if (permission) manifest.customPermissions.push(permission);
        } else if (name === 'application') {
          applicationOpen = true;
          manifest.application.debuggable = Boolean(attr('debuggable')?.value);
          const allowBackup = attr('allowBackup')?.value;
          manifest.application.allowBackup = typeof allowBackup === 'boolean' ? allowBackup : null;
          const cleartext = attr('usesCleartextTraffic')?.value;
          manifest.application.usesCleartextTraffic = typeof cleartext === 'boolean' ? cleartext : null;
          manifest.application.networkSecurityConfig = attr('networkSecurityConfig')?.value ? String(attr('networkSecurityConfig')?.value) : null;
          manifest.application.label = attr('label')?.value ? String(attr('label')?.value) : null;
          manifest.application.requestLegacyExternalStorage = Boolean(attr('requestLegacyExternalStorage')?.value);
        } else if (applicationOpen && ['activity', 'service', 'receiver', 'provider'].includes(name)) {
          const exported = attr('exported')?.value;
          currentComponent = {
            type: name as AndroidComponent['type'],
            name: String(attr('name')?.value ?? ''),
            exported: typeof exported === 'boolean' ? exported : null,
            permission: attr('permission')?.value ? String(attr('permission')?.value) : null,
            intentFilters: [],
          };
          manifest.components.push(currentComponent);
        } else if (name === 'intent-filter' && currentComponent) {
          const autoVerify = attributes.find((a) => a.name === 'autoVerify');
          currentFilter = { actions: [], schemes: [], hosts: [], autoVerify: Boolean(autoVerify?.value) };
          currentComponent.intentFilters.push(currentFilter);
        } else if (name === 'action' && currentFilter) {
          const action = String(attr('name')?.value ?? '');
          if (action) currentFilter.actions.push(action);
        } else if (name === 'data' && currentFilter) {
          const scheme = attr('scheme')?.value;
          const host = attr('host')?.value;
          if (scheme) currentFilter.schemes.push(String(scheme));
          if (host) currentFilter.hosts.push(String(host));
        }
      } else if (type === 0x0103) {
        // END_ELEMENT
        const closed = elementStack.pop();
        if (closed === 'application') applicationOpen = false;
        if (closed && ['activity', 'service', 'receiver', 'provider'].includes(closed)) currentComponent = null;
        if (closed === 'intent-filter') currentFilter = null;
        lastStartTag = closed ?? lastStartTag;
      }
      offset += chunkSize;
    }
  } catch (error) {
    manifest.parseErrors.push(`AXML parse error: ${(error as Error).message}`);
  }
  if (!manifest.packageName) manifest.parseErrors.push('Package name could not be determined from the binary manifest');
  return manifest;
}

function parsePlainManifest(xml: string): AndroidManifest {
  const manifest: AndroidManifest = {
    packageName: /package="([^"]+)"/.exec(xml)?.[1] ?? null,
    versionName: /android:versionName="([^"]+)"/.exec(xml)?.[1] ?? null,
    versionCode: /android:versionCode="([^"]+)"/.exec(xml)?.[1] ?? null,
    minSdk: /android:minSdkVersion="([^"]+)"/.exec(xml)?.[1] ?? null,
    targetSdk: /android:targetSdkVersion="([^"]+)"/.exec(xml)?.[1] ?? null,
    permissions: [...xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]),
    customPermissions: [...xml.matchAll(/<permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]),
    application: {
      debuggable: /android:debuggable="true"/.test(xml),
      allowBackup: /android:allowBackup="true"/.test(xml) ? true : /android:allowBackup="false"/.test(xml) ? false : null,
      usesCleartextTraffic: /android:usesCleartextTraffic="true"/.test(xml) ? true : /android:usesCleartextTraffic="false"/.test(xml) ? false : null,
      networkSecurityConfig: /android:networkSecurityConfig="([^"]+)"/.exec(xml)?.[1] ?? null,
      label: /android:label="([^"]+)"/.exec(xml)?.[1] ?? null,
      requestLegacyExternalStorage: /android:requestLegacyExternalStorage="true"/.test(xml),
    },
    components: [...xml.matchAll(/<(activity|service|receiver|provider)([\s\S]*?)>([\s\S]*?)<\/\1>/g)].map((match) => {
      const attrs = match[2];
      const body = match[3];
      return {
        type: match[1] as AndroidComponent['type'],
        name: /android:name="([^"]+)"/.exec(attrs)?.[1] ?? '',
        exported: /android:exported="true"/.test(attrs) ? true : /android:exported="false"/.test(attrs) ? false : null,
        permission: /android:permission="([^"]+)"/.exec(attrs)?.[1] ?? null,
        intentFilters: [...body.matchAll(/<intent-filter([\s\S]*?)>([\s\S]*?)<\/intent-filter>/g)].map((filter) => ({
          actions: [...filter[2].matchAll(/<action[^>]*android:name="([^"]+)"/g)].map((a) => a[1]),
          schemes: [...filter[2].matchAll(/<data[^>]*android:scheme="([^"]+)"/g)].map((d) => d[1]),
          hosts: [...filter[2].matchAll(/<data[^>]*android:host="([^"]+)"/g)].map((d) => d[1]),
          autoVerify: /autoVerify="true"/.test(filter[1]),
        })),
      };
    }),
    parseErrors: [],
  };
  return manifest;
}
