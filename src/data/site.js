// Todo el texto y los datos de la marca viven aquí.
// COAL HOUR es una marca INVENTADA para este sitio de demostración: direcciones ficticias y teléfono 555.
// En los titulares, cada elemento es una línea; "*" al inicio = línea en neón rojo.

export const brand = {
  name: 'Coal Hour',
  lines: ['COAL', 'HOUR'],
  phone: '555 0142',
};

export const ui = {
  loader: 'Lighting up',
  scroll: 'Scroll',
  dockA: 'Find us',
  dockB: 'Book the pit',
  footer: 'Concept brand · Not a real restaurant',
};

// Nombre de cada estación (barra superior) y el reloj: la noche va de 6:00 PM a 12:00 AM.
export const stations = ['Ember', 'Coal', 'Grate', 'Taco', 'Menu', 'Where', 'For hire', 'Midnight'];
export const clock = { from: 18 * 60, to: 24 * 60 };

export const copy = {
  hero: { label: 'Live-fire tacos', headline: ['Coal', 'Hour'], sub: 'Everything touches the fire.' },
  coal: { label: 'Pit temp', from: 72, to: 1100, unit: '°F', sub: 'Mesquite lump. No gas. Ever.' },
  grill: { label: 'The lineup', headline: ['Six cuts.', '*One fire.'], sub: 'Salt. Smoke. Nothing else.' },
  taco: { label: 'The signature', headline: ['The', '*Blackout'], sub: 'Ribeye, ash tortilla, salsa negra.', callouts: ['Ribeye', '1100°F', '90 sec a side'] },
  menu: { label: 'The board', headline: ['Short menu.', 'Long night.'], sub: 'Sold out means sold out.' },
  find: { label: 'Find us', headline: ['Follow', '*the smoke.'], sub: 'Two lots. Dusk to midnight.' },
  events: { label: 'Catering', headline: ['The pit', '*travels.'], sub: 'Rooftops, backyards, weddings. 30 to 300.', cta: 'Book the pit' },
  contact: { label: 'Last call', sub: 'Open until the coals die.' },
};

export const marquee = ['Ribeye', 'Picanha', 'Arrachera', 'Sirloin', 'Brisket', 'Chorizo'];

// img = vista previa (public/img/menu/<img>.webp).
export const menu = [
  { group: 'Tacos', note: 'Six cuts', items: [
    { name: 'The Blackout', img: 'blackout' }, { name: 'Picanha', img: 'picanha' }, { name: 'Arrachera', img: 'arrachera' },
    { name: 'Sirloin', img: 'sirloin' }, { name: 'Brisket', img: 'brisket' }, { name: 'Chorizo', img: 'chorizo' },
  ] },
  { group: 'From the coals', note: 'No pans. No foil.', items: [
    { name: 'Marrow', img: 'marrow' }, { name: 'Ember corn', img: 'ember-corn' }, { name: 'Volcán', img: 'volcan' }, { name: 'Queso fundido', img: 'queso-fundido' },
  ] },
  { group: 'Salsas', note: 'Stone-ground', items: [
    { name: 'Negra', img: 'negra' }, { name: 'Roja tatemada', img: 'roja-tatemada' }, { name: 'Verde cruda', img: 'verde-cruda' }, { name: 'Habanero piña', img: 'habanero-pina' },
  ] },
];

export const locations = [
  { name: 'North Lot', line: '1400 Smokestack Row · Kiln District', hours: 'Tue–Sun · 6 PM – 12 AM' },
  { name: 'River Lot', line: '77 Halfmoon Alley · Cinder Wharf', hours: 'Fri–Sat · 6 PM – 12 AM' },
];

export const neonText = 'OPEN LATE';

// "Fotos vivas": clip en bucle por foto (clave = nombre de archivo sin extensión).
export const videos = {
  'steaks-l': '/video/steaks-l.mp4',
  'steaks-p': '/video/steaks-p.mp4',
};
