import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dishes = [
  {
    name: 'veg-thali.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/fe/An_amazing_thali.jpg'
  },
  {
    name: 'paneer-butter-masala.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Paneer_Butter_Masala.jpg'
  },
  {
    name: 'veg-biryani.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/Hyderabadi_Vegetable_Biryani.jpg'
  },
  {
    name: 'chole-bhature.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/00/CHOLE_BHATURE.JPG'
  },
  {
    name: 'veg-puff.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Curry_puffs_%281862141216%29.jpg'
  },
  {
    name: 'samosa.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Samosa_of_Kerala_02.jpg'
  },
  {
    name: 'veg-sandwich.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a2/Vegetable_sandwich.jpg'
  },
  {
    name: 'masala-chai.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Masala_Chai.jpg'
  },
  {
    name: 'cold-coffee.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Cold_Coffee_2.jpg'
  },
  {
    name: 'fresh-lime-soda.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ac/Fresh_limeade.jpg'
  },
  {
    name: 'gulab-jamun.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/67/Gulab_jamun_-_Lavapies_%28Spain%29.JPG'
  },
  {
    name: 'chocolate-brownie.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/68/Chocolatebrownie.JPG'
  }
];

const headers = {
  'User-Agent': 'SmartCanteenApp/1.0 (Educational college mini-project; contact: admin@canteen.local)',
  'Referer': 'https://commons.wikimedia.org/'
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadRemaining() {
  console.log('Downloading remaining images with 3.5s delay...');
  for (const item of dishes) {
    const targetPath = resolve('public/images', item.name);
    if (existsSync(targetPath)) {
      console.log(`Skipping ${item.name} (already exists)`);
      continue;
    }

    try {
      await sleep(3500);
      const res = await fetch(item.url, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const arrayBuf = await res.arrayBuffer();
      writeFileSync(targetPath, Buffer.from(arrayBuf));
      console.log(`✓ Saved ${item.name} (${arrayBuf.byteLength} bytes)`);
    } catch (err) {
      console.error(`✕ Failed to download ${item.name}:`, err.message);
    }
  }
  console.log('Done.');
}

downloadRemaining();
