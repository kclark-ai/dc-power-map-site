import {readFileSync,existsSync} from 'node:fs';
let token=process.env.PUBLIC_MAPBOX_TOKEN;
if(!token&&existsSync('.env.local'))token=readFileSync('.env.local','utf8').match(/^PUBLIC_MAPBOX_TOKEN=["']?([^\s"']+)/m)?.[1];
if(!token?.startsWith('pk.')){console.error('Release configuration missing: set a browser-visible PUBLIC_MAPBOX_TOKEN (pk.) in the hosting build environment.');process.exit(1)}
console.log('Public map token configuration is present. Verify domain restrictions in Mapbox before publishing.');
