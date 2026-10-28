// Inbound HL7 v2 over MLLP. Only runs when the portal is a long-lived server (node src/server.js), not on Vercel.
// One TCP listener per enabled HL7 v2 MLLP connection that has a "listen port" and receives patients.
import net from 'node:net';
import { query } from '../../db/pool.js';
import * as engine from './engine.js';
import { mllpFrame, mllpUnframe } from './transports.js';

const servers = new Map(); // connection id → { port, server }

export async function refreshMllpListeners() {
  if (!(await engine.tablesReady())) return;
  const { rows } = await query(
    `SELECT id FROM integration_connection WHERE enabled AND protocol = 'HL7V2_MLLP' AND 'patientsInbound' = ANY(flows)
        AND coalesce(config->>'listenPort', '') ~ '^[0-9]+$'`);
  const wanted = new Map();
  for (const r of rows) {
    const conn = await engine.loadConnection(r.id);
    wanted.set(conn.id, Number(conn.config.listenPort));
  }
  for (const [id, s] of servers) {
    if (wanted.get(id) !== s.port) { s.server.close(); servers.delete(id); console.log(`[mllp] stopped listener on port ${s.port}`); }
  }
  for (const [id, port] of wanted) {
    if (servers.has(id)) continue;
    const server = net.createServer((sock) => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', async (d) => {
        buf += d;
        const { messages, rest } = mllpUnframe(buf);
        buf = rest;
        for (const msg of messages) {
          try {
            const conn = await engine.loadConnection(id);
            if (!conn?.enabled) { sock.end(); return; }
            const result = await engine.receive(conn, 'x-application/hl7-v2+er7', msg, { via: `MLLP ${sock.remoteAddress}` });
            sock.write(mllpFrame(engine.inboundReply(conn, msg, result).body));
          } catch (e) { console.error('[mllp]', e.message); }
        }
      });
      sock.on('error', () => {});
    });
    server.on('error', (e) => console.error(`[mllp] could not listen on port ${port}: ${e.code || e.message}`));
    server.listen(port, () => console.log(`[mllp] listening for HL7 v2 on port ${port}`));
    servers.set(id, { port, server });
  }
}
