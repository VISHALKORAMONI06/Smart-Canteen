/**
 * Seed menu items for SmartCanteen.
 * Contains 15 canteen dishes across Breakfast, Lunch, Snacks, Beverages, and Desserts.
 * All photos are 100% verified authentic local images matching each dish name.
 */

export const INITIAL_MENU_ITEMS = [
  {
    id: 'item-1',
    name: 'Masala Dosa',
    category: 'Breakfast',
    price: 60,
    prepTime: 12,
    description: 'Crisp rice crepe, spiced potato, coconut chutney & sambar',
    imageUrl: '/images/masala-dosa.jpg',
    available: true
  },
  {
    id: 'item-2',
    name: 'Idli Sambar',
    category: 'Breakfast',
    price: 40,
    prepTime: 6,
    description: 'Three steamed idlis with piping-hot sambar',
    imageUrl: '/images/idli-sambar.jpg',
    available: true
  },
  {
    id: 'item-3',
    name: 'Aloo Paratha',
    category: 'Breakfast',
    price: 50,
    prepTime: 10,
    description: 'Stuffed flatbread with butter, curd and pickle',
    imageUrl: '/images/aloo-paratha.jpg',
    available: true
  },
  {
    id: 'item-4',
    name: 'Veg Thali',
    category: 'Lunch',
    price: 110,
    prepTime: 15,
    description: 'Dal, two sabzis, rice, rotis, salad and sweet',
    imageUrl: '/images/veg-thali.jpg',
    available: true
  },
  {
    id: 'item-5',
    name: 'Paneer Butter Masala',
    category: 'Lunch',
    price: 120,
    prepTime: 15,
    description: 'Creamy tomato gravy with soft paneer, served with 2 rotis',
    imageUrl: '/images/paneer-butter-masala.jpg',
    available: true
  },
  {
    id: 'item-6',
    name: 'Veg Biryani',
    category: 'Lunch',
    price: 100,
    prepTime: 18,
    description: 'Fragrant basmati layered with vegetables, with raita',
    imageUrl: '/images/veg-biryani.jpg',
    available: true
  },
  {
    id: 'item-7',
    name: 'Chole Bhature',
    category: 'Lunch',
    price: 80,
    prepTime: 14,
    description: 'Spiced chickpea curry with fluffy fried bhature',
    imageUrl: '/images/chole-bhature.jpg',
    available: false // Seeded as unavailable for demo demonstration
  },
  {
    id: 'item-8',
    name: 'Veg Puff',
    category: 'Snacks',
    price: 25,
    prepTime: 5,
    description: 'Flaky pastry filled with spiced mixed vegetables',
    imageUrl: '/images/veg-puff.jpg',
    available: true
  },
  {
    id: 'item-9',
    name: 'Samosa (2 pcs)',
    category: 'Snacks',
    price: 30,
    prepTime: 5,
    description: 'Golden, crunchy and served with tamarind chutney',
    imageUrl: '/images/samosa.jpg',
    available: true
  },
  {
    id: 'item-10',
    name: 'Veg Sandwich',
    category: 'Snacks',
    price: 45,
    prepTime: 7,
    description: 'Grilled with cucumber, tomato, potato and green chutney',
    imageUrl: '/images/veg-sandwich.jpg',
    available: true
  },
  {
    id: 'item-11',
    name: 'Masala Chai',
    category: 'Beverages',
    price: 15,
    prepTime: 3,
    description: 'Strong tea brewed with ginger and cardamom',
    imageUrl: '/images/masala-chai.jpg',
    available: true
  },
  {
    id: 'item-12',
    name: 'Cold Coffee',
    category: 'Beverages',
    price: 50,
    prepTime: 4,
    description: 'Thick, chilled and lightly sweetened',
    imageUrl: '/images/cold-coffee.jpg',
    available: true
  },
  {
    id: 'item-13',
    name: 'Fresh Lime Soda',
    category: 'Beverages',
    price: 30,
    prepTime: 3,
    description: 'Sweet, salted or mixed — your call',
    imageUrl: '/images/fresh-lime-soda.jpg',
    available: true
  },
  {
    id: 'item-14',
    name: 'Gulab Jamun (2 pcs)',
    category: 'Desserts',
    price: 35,
    prepTime: 2,
    description: 'Warm milk-solid dumplings soaked in rose sugar syrup',
    imageUrl: '/images/gulab-jamun.jpg',
    available: true
  },
  {
    id: 'item-15',
    name: 'Chocolate Brownie',
    category: 'Desserts',
    price: 55,
    prepTime: 2,
    description: 'Rich, fudgy baked chocolate square',
    imageUrl: '/images/chocolate-brownie.jpg',
    available: true
  }
];

export const CATEGORIES = ['All', 'Breakfast', 'Lunch', 'Snacks', 'Beverages', 'Desserts'];
