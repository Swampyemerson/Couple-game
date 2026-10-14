// Doodle v2: modes, packs and the new prompt decks. Pure data, no imports.
//
// ORDER IS FOREVER. Saved matches store content as indices into
// [282 v1 prompts, then US easy/medium/tricky, KITCHEN easy/medium/tricky, OUTABOUT..., CREATURES...].
// Never edit, reorder or grow an existing tier (every later index would move): add a NEW deck at
// the END of NEW_DECKS instead.
// Prompt format: 'shown|also accepted|also accepted'.

export const US = [
  [
    'love lock|padlock on a bridge|love padlock|bridge padlock|padlock|lock|love locks',
    'two straws|shared milkshake|sharing a milkshake|one milkshake|milkshake|sharing a drink|shared drink',
    'matching mugs|couple mugs|his and hers mugs|mugs',
    'shared blanket|blanket for two|snuggle blanket|cozy blanket|blanket|sharing a blanket',
    'anniversary card|greeting card|love card|card with a heart',
    'two toothbrushes|toothbrush cup|toothbrush holder|toothbrushes|toothbrush',
    'house keys|new keys|keys to our place|keys',
    'single rose|red rose|rose|long stem rose',
    'heart balloon|balloon heart|heart shaped balloon|heart-shaped balloon',
    'clinking glasses|cheers|toasting glasses|two wine glasses|wine glasses',
  ],
  [
    'carved initials|initials on a tree|names carved in a tree|tree carving',
    'photo booth|photobooth|photo strip',
    'mixtape|mix tape|cassette|cassette tape|playlist',
    'forehead kiss|kiss on the forehead|kiss on forehead|head kiss',
    'piggyback ride|piggyback|piggy back|piggybacking',
    'sharing an umbrella|under one umbrella|umbrella for two|sharing umbrella|umbrella',
    'sharing headphones|one earbud each|sharing earbuds|share earbuds|sharing earphones|shared earphones',
    'stealing fries|stealing food|food thief|fry thief|fries',
    'grocery run|grocery shopping|groceries|grocery store|supermarket',
    'sunday pancakes|pancake breakfast|sunday breakfast|pancakes|pancake',
    'dancing in socks|sock dancing|sliding in socks|sock slide|socks|dancing',
    'couch nap|napping on the couch|couch napping|sleeping on the couch|nap|napping|couch|sofa nap|sofa|sleeping on the sofa|napping on the sofa',
    'love note on the mirror|note on the mirror|mirror note|lipstick note|sticky note|post it|post-it note|note',
    'car singalong|singing in the car|car karaoke|car sing along|carpool karaoke|karaoke',
    'goodnight text|good night text|text goodnight|goodnight message|good night message',
    'reading in bed|reading together|book in bed|bedtime reading|reading',
  ],
  [
    'the good side of the bed|side of the bed|my side of the bed|bed side',
    'arguing about the thermostat|thermostat war|thermostat fight|thermostat',
    'forehead thermometer|checking for a fever|sick day|taking a temperature|thermometer',
    'ugly christmas sweaters|matching sweaters|ugly sweater|ugly sweaters|christmas sweaters|christmas jumpers|ugly christmas jumpers|christmas sweater|christmas jumper',
    'airport hug|airport reunion|airport pickup|hugging at the airport|airport',
    'tangled earphones|tangled headphones|tangled wires|tangled cables',
    'lazy sunday|sunday morning|lazy morning|lazy day|sunday',
    'cooking together|cooking dinner|cooking as a team|cook together|cooking',
    'inside joke|private joke|secret joke|laughing at an inside joke',
    'saying i love you|i love you|telling someone i love you|love you',
  ],
];

export const KITCHEN = [
  [
    'ramen|instant noodles|cup noodles|ramen bowl|noodles',
    'dumplings|dumpling|gyoza|potstickers|dim sum',
    'croissant|croissants',
    'waffle|belgian waffle',
    'whisk|wire whisk|egg whisk',
    'kettle|tea kettle|teapot|tea pot',
    'bagel|bagel with cream cheese',
    'pretzel|soft pretzel',
    'frying pan|skillet|fry pan',
    'rolling pin|dough roller',
  ],
  [
    'grilled cheese|cheese toastie|toastie|grilled cheese sandwich',
    'bubble tea|boba|boba tea|bubble milk tea',
    'espresso machine|coffee machine|coffee maker|espresso maker|espresso',
    'oven mitt|oven glove|oven mitts|pot holder',
    'blender|making a smoothie|smoothie',
    'bowl of cereal|cereal bowl|cereal',
    'garlic bread|garlic toast',
    'birthday candles|candles on a cake|blowing out candles|candles|candle|birthday cake',
    'leftovers|takeout box|takeaway box|doggy bag|takeout|takeaway',
    'burnt cookies|burned cookies|burnt biscuits',
  ],
  [
    'spilled milk|spilt milk|crying over spilled milk',
    'empty fridge|open fridge|nothing to eat|fridge light',
    'midnight snack|late night snack|fridge raid|raiding the fridge',
    'too many cooks|too many cooks in the kitchen|crowded kitchen',
    'boiling over|pot boiling over|boiled over|overflowing pot',
    'smoke alarm|smoke detector|burnt dinner|fire alarm|burning dinner',
    'taste testing|tasting the sauce|taste test|tasting soup',
    'recipe disaster|kitchen disaster|cooking fail|kitchen fail',
    'flipping a pancake|pancake flip|tossing a pancake|flipping pancakes',
    'sharing dessert|sharing a spoon|one spoon two forks|sharing a dessert',
    'cookie dough|licking the spoon|licking the bowl|raw cookie dough|cookie batter',
  ],
];

export const OUTABOUT = [
  [
    'beach towel|towel on the sand|beach towels|towel',
    'passport|passports',
    'suitcase|luggage|travel bag|rolling suitcase',
    'campfire|bonfire|camp fire|fire pit',
    'snorkel|snorkeling|snorkelling|snorkel mask',
    'gondola|venice|gondolier',
    'hiking boots|hiking|hike|walking boots|boots|hiking shoes',
    'double-decker bus|london bus|double decker|double decker bus|bus',
    'subway|metro|underground|subway train',
    'compass|pocket compass',
  ],
  [
    'tent in the rain|camping in the rain|wet tent|rainy camping|tent|rainy tent',
    'drive-in movie|drive in|drive in movie|drive-in|outdoor cinema|outdoor movie',
    'farmers market|farmers’ market|farm market|veggie market|market',
    'souvenir shop|gift shop|souvenirs|souvenir',
    'rope bridge|suspension bridge|swaying bridge|bridge|hanging bridge|swinging bridge',
    'botanical garden|botanic garden|greenhouse|glasshouse',
    'hotel pillow mints|pillow mint|mint on the pillow|pillow mints',
    'sunrise hike|hiking at sunrise|sunrise on a mountain|watching the sunrise',
    'city skyline|skyline|night skyline|big city lights|cityscape|city view',
    'ferry ride|ferry|taking the ferry|boat ride|ferry boat',
  ],
  [
    'lost luggage|lost suitcase|missing luggage|lost bag|missing suitcase|lost baggage',
    'taking a wrong turn|wrong turn|lost on the road|lost in the car|getting lost|got lost',
    'airport security|security line|security check|going through security|security',
    'missed the train|missed the bus|missed flight|missed the plane|missing the train|missing the bus|missed train',
    'window seat|plane window|looking out the plane window|airplane window|plane seat|seat by the window',
    'asking a stranger for a photo|photo with a stranger|stranger takes our photo|tourist photo',
    'postcard from home|postcard|sending a postcard|writing a postcard',
    'hotel check in|hotel check-in|checking in|front desk|check in|check-in|reception',
    'map upside down|holding the map upside down|reading the map|lost with a map',
    'last minute packing|packing at the last minute|packing the night before|frantic packing',
    'hotel balcony|balcony view|balcony',
  ],
];

export const CREATURES = [
  [
    'sloth|sleepy sloth',
    'hedgehog|spiky hedgehog',
    'flamingo|pink flamingo',
    'koala|koala bear',
    'otter|sea otter',
    'raccoon|trash panda',
    'llama|alpaca',
    'jellyfish|jelly fish',
    'seahorse|sea horse',
    'chameleon|lizard',
    'hummingbird|humming bird',
    'panda|giant panda|panda bear',
    'sleeping cat|cat napping|cat curled up|cat sleeping|sleepy cat|napping cat',
  ],
  [
    'ducks in a row|ducklings in a row|mama duck and ducklings|row of ducks|ducklings|ducks|mama duck|duck family',
    'thunderstorm|thunder storm|thunder and lightning|storm|thunder',
    'foggy morning|fog|foggy|misty morning|mist|misty',
    'heatwave|heat wave|hot summer day|melting in the heat|hot day|hot weather|scorching sun',
    'first snow|snowfall|first snowfall|snow falling|snowing',
    'double rainbow|two rainbows|rainbows|rainbow',
    'puddle jumping|jumping in puddles|splashing in puddles|puddle splash|puddles|puddle',
    'tornado|twister|funnel cloud',
    'penguins huddling|penguin huddle|huddling penguins|penguins',
    'cat on a windowsill|cat in the window|cat at the window',
  ],
  [
    'rain on the window|raindrops on the window|rainy window|rain on the glass|rainy day|raining|rain',
    'sunshower|rain while sunny|sun and rain|sun shower|rain and sun',
    'northern lights|aurora|aurora borealis|the northern lights',
    'dog in the rain|wet dog|soaked dog|dog shaking off water|wet puppy',
    'raking leaves|autumn leaves|pile of leaves|falling leaves',
    'geese flying south|flock of geese|geese in a v|birds migrating|geese|migrating birds',
    'snow day|snowed in|snowed-in|stuck in the snow|snow',
    'sunset over the sea|ocean sunset|sunset on the beach|sun setting over water|sunset over the ocean|sunset over water',
    'windy day|umbrella blowing away|windy|gust of wind|wind',
  ],
];

export const HOME = [
  [
    'houseplant|potted plant|house plant|plant',
    'doormat|welcome mat|mat',
    'bookshelf|bookcase|shelf of books|shelves',
    'lamp|desk lamp|table lamp|reading lamp',
    'rug|carpet|area rug',
    'jigsaw puzzle|puzzle|puzzle piece|jigsaw',
    'board game|boardgame|game night',
    'record player|turntable|vinyl|record',
    'fireplace|fire place|hearth|chimney',
    'bird feeder|birdfeeder|feeder',
    'stairs|staircase|steps',
    'watering can|watering the plants|watering plants',
  ],
  [
    'knitting|knitting needles|knit|crochet',
    'spring cleaning|deep clean|big clean|cleaning day|cleaning',
    'mowing the lawn|lawn mower|lawnmower|mowing|cutting the grass',
    'taking out the trash|taking out the bins|bin day|trash day|garbage night|taking the bins out',
    'making the bed|make the bed|changing the sheets|fresh sheets|bed sheets',
    'ironing|ironing board|iron|ironing a shirt',
    'face mask|sheet mask|skincare|skin care|face mask night',
    'moving boxes|moving day|packing boxes|cardboard boxes|moving house',
    'hanging a picture|hanging a frame|crooked picture|picture frame|wall frame',
    'baking bread|sourdough|bread|loaf of bread|homemade bread',
    'tangled christmas lights|christmas lights|fairy lights|string lights|untangling lights',
  ],
  [
    'lost sock|missing sock|odd socks|where did the other sock go|one sock',
    'stubbed toe|stubbing your toe|stubbed my toe|toe',
    'wifi password|the wifi password|password',
    'creaky floorboard|creaky floor|squeaky floorboard|squeaky floor',
    'doorbell at dinner|unexpected guest|surprise visitor|someone at the door|doorbell',
    'power cut|power outage|blackout|the lights went out|no power',
    'hitting snooze|snooze button|snooze|overslept|oversleeping|sleeping in',
    'noisy neighbours|noisy neighbors|loud neighbours|loud neighbors|banging on the wall',
    'phone charger|lost charger|charger|charging cable|where is the charger',
    'locked out|locked out of the house|locked outside',
  ],
];

// Order = index order after the 282 v1 prompts. Append new decks at the END only.
export const NEW_DECKS = [
  { id: 'us', tiers: US },
  { id: 'kitchen', tiers: KITCHEN },
  { id: 'outabout', tiers: OUTABOUT },
  { id: 'creatures', tiers: CREATURES },
  { id: 'home', tiers: HOME },
];

export const MODE_LIST = ['classic', 'halfhalf', 'ladder', 'invisible', 'mixed'];
export const MODE_INFO = {
  classic: { title: 'Classic', pitch: 'Pick 1 of 3 cards. Harder cards pay more.' },
  halfhalf: { title: 'Half & Half', pitch: 'Guess from half a drawing for bonus points.' },
  ladder: { title: 'Ladder', pitch: 'No picking. Nail it and the cards get harder.' },
  invisible: { title: 'Invisible Ink', pitch: 'Your lines fade as you draw. +1 per hit.' },
  mixed: { title: 'Mixed Bag', pitch: 'A fresh twist every round.' },
};
export const PACK_LIST = ['classic', 'us', 'kitchen', 'outabout', 'creatures', 'home', 'everything'];
export const PACK_INFO = {
  classic: { title: 'Classic', pitch: 'The original 282 cards.' },
  us: { title: 'Us', pitch: 'Couple moments.' },
  kitchen: { title: 'Kitchen', pitch: 'Cooking, snacking, spilling.' },
  outabout: { title: 'Out & About', pitch: 'Trips, trails and travel.' },
  creatures: { title: 'Creatures & Weather', pitch: 'Animals, skies and storms.' },
  home: { title: 'Home Sweet Home', pitch: 'Rooms, chores and little dramas.' },
  everything: { title: 'Everything', pitch: 'Every card in one deck.' },
};
export const TWIST_LIST = ['normal', 'halfhalf', 'invisible', 'sprint', 'oneline'];
export const TWIST_INFO = {
  normal: { title: 'Plain round', pitch: 'No twist. Just draw.' },
  halfhalf: { title: 'Half & Half', pitch: 'Your partner can call it from half the drawing.' },
  invisible: { title: 'Invisible ink', pitch: 'Your lines fade as you draw. +1 on a hit.' },
  sprint: { title: 'Sprint', pitch: '35 seconds. +1 on a hit.' },
  oneline: { title: 'One line', pitch: 'Lift your finger once. +1 on a hit.' },
};
