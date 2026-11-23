const P = {
  cup: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5"/>',
  glass: '<path d="M6 3.5h12l-1.6 15.2a2 2 0 0 1-2 1.8H9.6a2 2 0 0 1-2-1.8L6 3.5Z"/><path d="M6.6 9h10.8"/>',
  bread: '<path d="M4 15c0-5 3.6-9 8-9s8 4 8 9v2.5H4V15Z"/><path d="M9 7.5 10 17.5M15 7.5 14 17.5"/>',
  cake: '<path d="M3.5 19.5h17v-7l-17-5v12Z"/><path d="M3.5 13.5h17M12 4.5v3"/>',
  set: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 12h17M12 6v13"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
  bottle: '<path d="M10 2.5h4M10.5 2.5v4L8 10v9.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V10l-2.5-3.5v-4"/><path d="M8 13h8"/>',
  wine: '<path d="M7.5 3.5h9l-.5 5a4 4 0 0 1-8 0l-.5-5Z"/><path d="M12 12.5v8M8.5 20.5h7"/>',
  pizza: '<path d="M12 21 3.5 5.5a17 17 0 0 1 17 0L12 21Z"/><circle cx="10" cy="9.5" r="1"/><circle cx="14" cy="12" r="1"/>',
  bowl: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M8 20.5h8M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19 13 11"/>',
  tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Z"/><circle cx="8" cy="8" r="1.3"/>',
  pos: '<path d="M4 7h16l-1.4 10.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 7Z"/><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7"/>',
  stock: '<path d="M3 9 12 4l9 5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z"/><path d="M7 20v-7h10v7M7 16h10"/>',
  items: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5.1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  barcode: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M16 8v8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  table: '<path d="M3 8h18M5 8v11M19 8v11M3 8l2-3h14l2 3"/>',
  doc: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h11"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  park: '<path d="M6 4h12v16l-6-4-6 4V4Z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  printer: '<path d="M7 8V3.5h10V8M7 17H4.5V9.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17"/><path d="M7 14h10v6.5H7z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  wifioff: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 5M12 20h.01"/>',
};
export const CAT_ICONS = ['cup', 'glass', 'bottle', 'wine', 'bread', 'cake', 'pizza', 'bowl', 'leaf', 'set', 'box', 'tag'];

export default function Icon({ name, size, stroke = 1.7, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] || P.box }} {...rest} />
  );
}
