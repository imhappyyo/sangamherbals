'use strict';
/**
 * Ayurvedic Dosha Classifier for Sangam Herbals product catalog.
 * Classifies each of 358 products into Vata / Pitta / Kapha (1-3 doshas each).
 *
 * Classification approach:
 *  1. Exact product-ID overrides (for special-case products).
 *  2. Keyword rules applied to the lowercased title (+ category + concerns).
 *  3. Section / category fallbacks so that no product is left with 0 doshas.
 */

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = '/Users/praveenrathi/Desktop/sangamherbals-eu/data/catalog.json';
const OUT_PATH     = '/Users/praveenrathi/Desktop/sangamherbals-eu/data/doshas.json';

// ─── helpers ─────────────────────────────────────────────────────────────────
function unique(arr) {
  return [...new Set(arr)];
}
function has(text, ...terms) {
  return terms.some(t => text.includes(t));
}

// ─── EXACT OVERRIDES (by product ID) ────────────────────────────────────────
// These handle products whose titles are ambiguous without Ayurvedic context.
const OVERRIDES = {
  // Triphala (all forms) — tridoshic
  229370199282: ['vata','pitta','kapha'], // Triphala Powder 40g
  414813563612: ['vata','pitta','kapha'], // Triphala Guggul Churna
  838438499422: ['vata','pitta','kapha'], // Triphala Plus Churna
  959573687672: ['vata','pitta','kapha'], // Triphala Churna 100g
  861865044952: ['vata','pitta','kapha'], // Triphala Guggul Tablets
  457779499602: ['vata','pitta','kapha'], // Triphala Tablets
  483974295732: ['vata','pitta','kapha'], // Triphala Natural Juice

  // Soan Papdi sweets — nourishing/warming = vata
  585210232542: ['vata'],                 // Soan Papdi Desi Ghee
  1512277416:   ['vata'],                 // Soan Papdi Premium

  // Chyawanprash — vata + kapha
  832410349382: ['vata','kapha'],

  // Dashmula — vata (joints)
  324532123722: ['vata'],
  480473150562: ['vata'],
  154301403842: ['vata'],

  // Avipattikar churna — pitta (primary) + kapha (digestive)
  222348857642: ['pitta','kapha'],
  344336193362: ['pitta','kapha'],

  // Dhatupaushtic — vata (nourishing/men's vitality)
  990036670052: ['vata'],

  // Yogaraj Guggul — vata (joints)
  413456763952: ['vata'],
  609118880262: ['vata'],

  // Medohar (weight/metabolism) — kapha
  256521114142: ['kapha'],
  950159941422: ['kapha'],
  883433550762: ['kapha'],

  // Kaishore Guggul — pitta (blood/skin)
  458212115002: ['pitta'],

  // Kanchanar Guggul — kapha (thyroid)
  299448253692: ['kapha'],

  // Ajmodadi Churna — vata (joints) + kapha (digestive stimulant)
  795026202822: ['vata','kapha'],

  // Snana Churna (body cleanser) — pitta (skin) + kapha (detox)
  855901451802: ['pitta','kapha'],

  // Multani Mitti (fullers earth) — pitta (cooling skin)
  483944023222: ['pitta'],

  // Yamuna Giri Churna (digestive) — kapha
  447088190012: ['kapha'],

  // Gokhru (urinary tonic) — vata (urinary = vata seat) + kapha (diuretic)
  842333912822: ['vata','kapha'],
  758661882512: ['vata','kapha'],

  // Vijayasar — kapha (diabetes)
  993285798782: ['kapha'],

  // Bilva — pitta (cooling, digestive)
  611267353222: ['pitta'],

  // Nagarmotha — vata (digestive tonic, grounding)
  794323485152: ['vata'],

  // Lavan Bhaskar — kapha (digestive stimulant)
  359470486392: ['kapha'],

  // Panchsakar — kapha (laxative/digestive)
  733143377802: ['kapha'],

  // Maha Sudarshan — kapha (fever/immunity) + pitta (anti-fever)
  485161007242: ['pitta','kapha'],

  // Shatavari Plus — vata + pitta
  638605841112: ['vata','pitta'],

  // Relax body gel — vata (calming, warming)
  601745043882: ['vata'],

  // Herbal dry shampoo — vata (hair nourishment)
  480859976082: ['vata'],

  // Herbal Hair Mask — vata
  194759583852: ['vata'],

  // Dosha massage oil / Mahanarayan — vata
  574168227172: ['vata'],

  // Coconut oil — pitta only
  756684318212: ['pitta'],

  // Sesame oil — vata (warming)
  315359125642: ['vata'],

  // Yellow Mustard oil — kapha (stimulating/pungent)
  189591996782: ['kapha'],

  // Black seed / Kalonji oil — kapha (immunity/metabolic)
  788158557142: ['kapha'],

  // Kumkumadi face oil — pitta (skin care, saffron)
  1768240112:   ['pitta'],

  // Jivan Cream-Balm — vata (warming healing balm)
  469582041732: ['vata'],

  // Serpenol (blood purifying) — pitta + kapha
  192415516172: ['pitta','kapha'],

  // Dermato Care — pitta (skin) + kapha (blood purifying)
  376264552522: ['pitta','kapha'],

  // Mentox — pitta (liver detox) + kapha (metabolic)
  810636288142: ['pitta','kapha'],

  // Pro-Liv — pitta (liver)
  797018895582: ['pitta'],

  // Pro-Piles — kapha (venous/pile = kapha)
  572849291892: ['kapha'],

  // Vercoz — kapha (varicose/circulation stimulant)
  757897187002: ['kapha'],

  // Vermicidol — kapha (parasite = kapha)
  154116185222: ['kapha'],

  // Pro-Septilin — kapha (immunity)
  262654853862: ['kapha'],

  // Pyuren (blood purifier) — pitta + kapha
  283999037122: ['pitta','kapha'],

  // Trishun — vata (pain) + kapha (immunity)
  732258895022: ['vata','kapha'],

  // Cholestro — kapha (cholesterol)
  505423244662: ['kapha'],

  // Cysto (kidney/urinary) — kapha + vata
  990181142902: ['vata','kapha'],

  // Sanzpazm — vata (musculo-spasm) + kapha
  360104264222: ['vata','kapha'],

  // Uric Care — kapha (uric acid)
  112687696632: ['kapha'],

  // Florabiotic-Ex — kapha (immunity/gut)
  332511464642: ['kapha'],

  // Shape It Slim — kapha (weight)
  817661997572: ['kapha'],

  // Dialex — kapha (diabetes)
  739572494442: ['kapha'],

  // Diab-Et — kapha (diabetes)
  981930821672: ['kapha'],

  // Hypothyro — kapha (thyroid)
  548957997012: ['kapha'],

  // Immunosad — kapha (immunity)
  540036691:   ['kapha'],

  // Tinovit — kapha (immunity/tinnitus)
  1673390359:  ['kapha'],

  // Airolks — kapha (respiratory/arthritis)
  1670425416:  ['kapha'],

  // Sinovit — kapha (respiratory)
  1673399491:  ['kapha'],

  // Sinodek — kapha (sinus/respiratory)
  1673326051:  ['kapha'],

  // Neuroxil — vata (nervous system)
  1679654306:  ['vata'],

  // Melat — pitta (melatonin/hormonal/women)
  1672268135:  ['pitta'],

  // Megalex — vata (general tonic/energy)
  1672321407:  ['vata'],

  // Garcinia — kapha (weight/metabolism)
  336371297:   ['kapha'],

  // Shiva Gutika (digestive energy) — vata + kapha
  416365874702: ['vata','kapha'],

  // Gastro Care — pitta (acidity/digestion)
  986029499702: ['pitta'],

  // Ramulla — vata (men's vitality/reproductive)
  712926062202: ['vata'],

  // Joint Care — vata (joints)
  327771785402: ['vata'],

  // Calci-Cor — vata (bone/joint)
  674696915162: ['vata'],

  // Turmeric-Boswellia — vata (joint anti-inflammatory)
  546767840762: ['vata'],

  // Shallaki churna + tablets — vata (joints)
  983383507232: ['vata'],
  348900067582: ['vata'],

  // Eyexol — pitta (eye = pitta seat)
  909418280472: ['pitta'],

  // Breast Care — pitta (hormonal/women)
  112006669892: ['pitta'],

  // Pro-Leukor — pitta (women's leucorrhoea)
  479011376742: ['pitta'],

  // Menophyt — pitta (menopause/hormonal)
  270525201382: ['pitta'],

  // Women's Health Tablets — pitta
  199225828902: ['pitta'],
  548693476:    ['pitta'],   // Women Health Tablets (duplicate product variant)

  // Vigor Plus M — vata (men's vitality)
  776757379272: ['vata'],

  // Confidex — vata (men's vitality)
  640172116112: ['vata'],

  // Men Health Tablets — vata
  991910211962: ['vata'],

  // Speman — vata (men's reproductive)
  953914598572: ['vata'],

  // Rejuven — vata (anti-aging/nourishing tonic)
  677081222732: ['vata'],

  // Pro-Heart — kapha (heart = pitta but cholesterol = kapha)
  593716346462: ['kapha'],

  // Pro-Memory — vata (mind/memory)
  633730105102: ['vata'],

  // Shankhapushpi — vata (mind/sleep)
  801716260142: ['vata'],

  // De-Stress — vata (stress/nervous system)
  785703890802: ['vata'],

  // Pro-Sleep — vata (sleep)
  721892628902: ['vata'],

  // Pro-Prostat — vata (prostate = vata)
  621674886112: ['vata'],

  // Tagara churna + tablets — vata (sedative)
  720659000872: ['vata'],
  793339156842: ['vata'],

  // Jatamansi — vata (grounding)
  607294835752: ['vata'],

  // Kapikachhu churna + tablets — vata (men's vitality)
  929327801212: ['vata'],
  763844191542: ['vata'],

  // Amla churna (supplement context) — vata + pitta
  152096329162: ['vata','pitta'],

  // Amla tablets — vata + pitta
  975564000992: ['vata','pitta'],

  // Candied amla — vata + pitta
  158879750482: ['vata','pitta'],
  945061066592: ['vata','pitta'],

  // Amla natural juice — vata + pitta
  725891721992: ['vata','pitta'],

  // Amla Giloe juice — pitta + kapha (amla+giloy)
  493666480842: ['pitta','kapha'],

  // Amla Arjuna juice — vata + pitta + kapha (amla=pitta, arjuna=kapha)
  954812240812: ['vata','pitta','kapha'],

  // Triphala juice — tridoshic
  483974295732: ['vata','pitta','kapha'],

  // Giloy churna + tablets — pitta + kapha
  953921961612: ['pitta','kapha'],
  610172056212: ['pitta','kapha'],

  // Moringa churna + tablets — pitta + kapha
  858542917452: ['pitta','kapha'],
  646547577512: ['pitta','kapha'],

  // Papaya leaf tablets — kapha (immunity/platelet)
  766660819692: ['kapha'],

  // Brahmi churna + tablets — vata + pitta
  381384322552: ['vata','pitta'],
  120000596542: ['vata','pitta'],

  // Bhringraj churna + tablets — vata (hair/grounding)
  296097045582: ['vata'],
  611060357512: ['vata'],

  // Shatavari churna + tablets — vata + pitta
  341084075442: ['vata','pitta'],
  387843740232: ['vata','pitta'],

  // Shatavari Plus Churna — vata + pitta
  638605841112: ['vata','pitta'],

  // Yashtimadhu / mulethi churna + tablets — vata + pitta
  969762260452: ['vata','pitta'],
  760531659952: ['vata','pitta'],

  // Anantha Mul Churna — vata (grounding, cooling)
  485292133612: ['vata'],

  // Anantamul Churna (Sariva) — vata (blood tonic, cooling)
  1769300178:   ['vata','pitta'],

  // Punarnava churna + tablets — kapha + pitta (water retention)
  272180978542: ['kapha','pitta'],
  344804949362: ['kapha','pitta'],

  // Manjistha churna + tablets — pitta (blood/skin)
  962248328172: ['pitta'],
  760122698242: ['pitta'],

  // Neem churna/tablets — pitta + kapha
  672854937572: ['pitta','kapha'],
  276148449322: ['pitta','kapha'],

  // Tulsi churna/tablets — vata + kapha
  746856028852: ['vata','kapha'],
  540494392882: ['vata','kapha'],

  // Vasaka churna + tablets — pitta + kapha (respiratory cooling)
  337282338542: ['pitta','kapha'],
  476349550892: ['pitta','kapha'],

  // Sitopaladi churna — kapha (respiratory)
  350099678822: ['kapha'],

  // Talisadi churna — kapha (respiratory/digestive)
  843409008062: ['kapha'],

  // Trikatu churna — kapha (metabolic stimulant)
  360094603442: ['kapha'],

  // Pippali churna + tablets — kapha (respiratory/metabolic)
  588447923772: ['kapha'],
  973990824662: ['kapha'],

  // Karela churna + tablets — kapha (diabetes)
  658231863352: ['kapha'],
  660418741732: ['kapha'],

  // Gudmar Patra — kapha (diabetes/anti-sweet)
  802977761682: ['kapha'],

  // Karela Jamun Juice — kapha (diabetes)
  903751840632: ['kapha'],

  // Natural Karela Juice — kapha (diabetes)
  505409490052: ['kapha'],

  // Arjuna churna + tablets — kapha (heart/cholesterol)
  661835905212: ['kapha'],
  932854292732: ['kapha'],

  // Haritaki churna + tablets — vata (digestive tonic)
  298974075172: ['vata'],
  378400870992: ['vata'],

  // Isabgol — kapha + vata (fibre, both)
  175182125602: ['vata','kapha'],

  // Vidanga — kapha (digestive/parasites)
  203866120322: ['kapha'],

  // Bakuchi churna — kapha (skin conditions)
  968964793442: ['kapha'],

  // Bala churna — vata (nourishing/grounding)
  350952768902: ['vata'],

  // Hair Growth Tablets — vata
  914006974022: ['vata'],

  // Himalayan Gold / Shilajit — vata (tonic/grounding)
  188866237032: ['vata'],

  // Flengi Immunity Booster juice — kapha
  418120517962: ['kapha'],

  // Noni juice — pitta + kapha (antioxidant + immunity)
  694955424702: ['pitta','kapha'],

  // Jamun juice — kapha (blood sugar)
  641002501222: ['kapha'],

  // All is Well Turmeric Juice — pitta (anti-inflammatory/pitta cooling)
  920473357022: ['pitta'],

  // All in Balance+ (Garcinia + Green Coffee) — kapha (weight/metabolism)
  973108344722: ['kapha'],

  // Immunity Plus Juice — kapha
  1767899717:   ['kapha'],

  // Aloe Vera Juice with Tulsi Seeds — pitta + kapha
  2576124654:   ['pitta','kapha'],

  // Turmeric Juice with Black Pepper 500ml — pitta + kapha
  320536288:    ['pitta','kapha'],

  // Indian Teas (warming/stimulating) — kapha (stimulating) + vata (warming)
  845177686532: ['vata','kapha'],
  799702096502: ['vata','kapha'],
  694018277172: ['vata','kapha'],
  910405670242: ['vata','kapha'],
  102597279052: ['vata','kapha'],
  255974925912: ['vata','kapha'],
  585901601182: ['vata','kapha'],

  // Slimness Herbal Tea — kapha (weight/metabolism)
  238410989252: ['kapha'],

  // Relax Herbal Tea — vata (calming/stress)
  729110593302: ['vata'],

  // Vigor Herbal Tea — kapha (stimulating/energizing)
  751745019352: ['kapha'],

  // Tulsi-based lozenges — vata + kapha
  1509121882:   ['vata','kapha'],  // Tulsi-Ginger
  1511794400:   ['pitta','kapha'], // Turmeric Herbal Lozenges
  1511872869:   ['vata','kapha'],  // Tulsi-Mint
  1511671030:   ['vata','kapha'],  // Tulsi-Orange
  1511883930:   ['vata','kapha'],  // Tulsi-Lemon
  1511924194:   ['vata','kapha'],  // Herbal Cough-Relief Assorted

  // Body Lotions — vata (nourishing/moisturising)
  3452012559:   ['vata'],  // Almond Oat Milk & Rose
  3452046339:   ['vata'],  // Cucumber & Tea Tree
  4319392092:   ['vata'],  // Avocado
  4319590762:   ['vata'],  // Vanilla
  3451971427:   ['vata'],  // Pomegranate & Lotus

  // Aloe face gels — pitta (cooling/skin)
  888201137082: ['pitta'],  // Aloe Face Gel Secret Garden
  563057406062: ['pitta'],  // Aloe Face Gel Jasmine & Bergamot
  458861952472: ['pitta'],  // Aloe Vera Face Gel Neem & Tulsi
  3424422272:   ['pitta'],  // Tea Tree Aloe Face Gel
  3424465467:   ['pitta'],  // Saffron Aloe Face Gel
  3424296187:   ['pitta'],  // Neem Aloe Face Gel
  4291419976:   ['pitta'],  // Rose Aloe Face Gel
  3424380733:   ['pitta'],  // Cucumber Aloe Face Gel

  // Face toners — pitta
  624510304952: ['pitta'],  // Rose Water Toner
  298157067182: ['pitta'],  // Cucumber Water Facial Toner

  // Face masks — pitta
  571036907162: ['pitta'],  // Peach Ayurvedic Face Mask
  805985696582: ['pitta'],  // Ayurvedic Face Mask Sandalwood & Almond
  572573127282: ['pitta'],  // Ayurvedic Face Mask Orange & Lemon
  910930446602: ['pitta'],  // Ayurvedic Face Mask Secret Garden
  738761869802: ['pitta'],  // Ayurvedic Face Mask Neem & Tulsi

  // Face scrubs (ubtan) — vata + pitta
  431975773842: ['vata','pitta'],  // Face Scrub Ubtan Neem & Tulsi
  401773692352: ['vata','pitta'],  // Face Scrub Ubtan Tropical Orange
  709417944982: ['vata','pitta'],  // Face Scrub Ubtan Secret Garden
  756979923472: ['vata','pitta'],  // Aloe Face Scrub Sweet Sandalwood
  659168099112: ['vata','pitta'],  // Aloe Face Scrub Blooming Orange
  431806959342: ['vata','pitta'],  // Aloe Face Scrub Neem & Tulsi
  4292004809:   ['vata','pitta'],  // Rose Aloe Face Scrub

  // Body scrubs (ubtan) — vata
  771615697002: ['vata'],  // Body Scrub Ubtan Tropical Orange
  182693733972: ['vata'],  // Body Scrub Ubtan Neem & Tulsi
  915504239112: ['vata'],  // Secret Garden Body Scrub

  // Aloe Vera Shower Gels — pitta + vata
  241671836712: ['pitta','vata'],  // Peach
  399231246232: ['pitta','vata'],  // Lemon & Verbena
  584437694632: ['pitta','vata'],  // Lavender & Ylang-Ylang
  488725696442: ['pitta','vata'],  // Green Apple
  996019419522: ['pitta','vata'],  // Sensual Therapy
  915838382732: ['pitta','vata'],  // Fresh Breeze
  // Neem & Tulsi shower gel — pitta + kapha
  986124229842: ['pitta','kapha'],
  // Aloe Body Wash — pitta + vata
  186699244392: ['pitta','vata'],

  // Soaps — pitta (cooling/cleansing)
  629680707302: ['pitta'],  // Apricot & Kokum Butter
  665051615912: ['pitta'],  // Aloe & Calendula
  778997239532: ['pitta'],  // Orange & Neroli
  264386752752: ['pitta'],  // Grapefruit & Green Tea
  859531331232: ['pitta'],  // Jasmine
  834865286982: ['pitta'],  // Mint & Tea Tree
  411260741192: ['pitta'],  // Lavender & Tulsi
  181847327632: ['pitta'],  // Lemongrass & Tulsi
  708665126472: ['pitta'],  // Honey & Almond
  175066591392: ['pitta','kapha'], // Neem & Tulsi
  514159981972: ['pitta'],  // Sandalwood & Turmeric
  224018530092: ['pitta'],  // Herbal Scrub
  889320930822: ['pitta'],  // Apple & Cinnamon — warming pitta + vata
  352146613122: ['pitta'],  // Rose

  // Toothpastes — pitta (mouth/digestion starts at pitta)
  942794467302: ['pitta'],
  964953302732: ['pitta'],
  4292857652:   ['pitta'],  // Red Repair toothpaste
  296624096:    ['pitta'],  // Total Care toothpaste

  // Herbal shampoos
  229975927502: ['pitta','kapha'],  // Neem & Tulsi Shampoo
  754115137732: ['vata','pitta'],   // Amla & Shikakai Shampoo
  862248004702: ['vata'],           // Sandalwood & Almond Shampoo
  4318330212:   ['vata'],           // Coconut Milk & Rose Shampoo

  // Hair conditioners — vata
  788504822202: ['vata'],           // Neem & Tulsi Conditioner
  303776543722: ['vata'],           // Amla & Shikakai Conditioner
  725405587302: ['vata'],           // Sandalwood & Almond Conditioner

  // Hair oils — vata
  886002530212: ['vata'],  // Mahabhringraj Hair Oil
  133731686452: ['vata'],  // Sangam Amla Hair Oil
  115767068462: ['vata'],  // Kesh Komal Hair Oil
  121623668632: ['vata'],  // Sangamrit Hair Oil

  // Henna and hair colour — vata + pitta
  814252068652: ['vata','pitta'],  // Henna with Herbal Blend
  171858345632: ['vata','pitta'],  // Natural Henna Powder 100g
  544116922462: ['vata','pitta'],  // Pure Natural Henna with Herbal Blend
  633655156592: ['vata','pitta'],  // H2 Dark Brown
  273018567452: ['vata','pitta'],  // H3 Special Brown
  492065281472: ['vata','pitta'],  // H4 Light Brown Cappuccino
  348134762152: ['vata','pitta'],  // N5 Chestnut
  439264265892: ['vata','pitta'],  // N7 Auburn
  120278340852: ['vata','pitta'],  // N12 Golden Bronze
  786187844652: ['vata','pitta'],  // N13 Natural Black
  675116744802: ['vata','pitta'],  // N6 Dark Brown
  781569872762: ['vata','pitta'],  // N7 Brown Olive Blonde
  232258399542: ['vata','pitta'],  // N8 Light Brown Hazelnut
  443712681232: ['vata','pitta'],  // FH2 Red Intense Red
  986230158952: ['vata','pitta'],  // FH3 Noble Copper

  // Hydrolats — pitta (cooling/floral)
  1682342552:   ['pitta'],  // Rose Water Hydrolat
  1768830014:   ['pitta'],  // Calendula Hydrolat
  1769067053:   ['pitta'],  // Damask Rose Hydrolat
  1769041117:   ['pitta'],  // Panch Pushp Five-Flower Hydrolat
  1768815614:   ['pitta'],  // White Lotus (Kewra) Hydrolat
  1768788182:   ['pitta'],  // Vetiver Hydrolat
  1769109673:   ['pitta'],  // Saffron Hydrolat
  1769057847:   ['pitta'],  // Rose & Jasmine Hydrolat
  1769098187:   ['pitta'],  // Sandalwood Hydrolat
  1768842436:   ['pitta','kapha'],  // Neem & Tulsi Hydrolat
  1768825254:   ['pitta'],  // Lavender Hydrolat

  // Attars / Perfume oils — classified by character
  3525469985:   ['vata'],       // Sandalwood — woody/warm/grounding
  3525469830:   ['vata'],       // Oud Wood — woody/warm
  3525470118:   ['kapha'],      // Al Bakhoor — heavy/earthy (bakhoor=oud resin)
  4293585296:   ['kapha'],      // Sly BossMan — heavy/musky (kapha)
  3525470180:   ['pitta'],      // Lavender — cooling/floral
  3525469989:   ['pitta'],      // Lotus — cooling/floral
  3525470172:   ['pitta'],      // Saffron — cooling/floral
  3525470035:   ['pitta'],      // Neroli — floral/cooling
  3525470055:   ['kapha'],      // Patchouli — heavy/earthy
  3525470090:   ['kapha'],      // Leather — heavy/earthy
  3525470095:   ['kapha'],      // Annaya — heavy/earthy
  3525469996:   ['pitta'],      // Jasmine — floral/cooling
  3812637106:   ['kapha'],      // Black Musk — heavy/dark
  3812813282:   ['kapha'],      // Musk Al Rijali — heavy/musky
  3812942615:   ['kapha'],      // Moon — mysterious/heavy
  3525469998:   ['vata'],       // Vanilla — warm/grounding
  3525470031:   ['pitta'],      // Indian Rose — floral/cooling
  3525470039:   ['vata'],       // Amber — warm/resinous/grounding
  3525470083:   ['kapha'],      // Nag Champa — heavy/earthy
  3525470087:   ['vata'],       // White Oud Wood — warm/woody
  3525470093:   ['kapha'],      // Love — heavy floral musk
  3525470202:   ['kapha'],      // Black Opium — dark/heavy
  3525470211:   ['kapha'],      // Black Orchid — dark/heavy
  3525470337:   ['kapha'],      // Plum — heavy/sweet dark
  3812847547:   ['kapha'],      // Jannat ul Firdaus — sweet/heavy musk
  3812988020:   ['pitta'],      // Rose Arabica — floral/cooling
  3813073516:   ['kapha'],      // White Patchouli — earthy
  3813115678:   ['kapha'],      // Sultan — majestic/heavy
  4293288890:   ['kapha'],      // Silver Musk — musky
  3812726736:   ['kapha'],      // White Musk — musky
  3812894936:   ['kapha'],      // Coco — sweet/heavy
  3813028203:   ['pitta','vata'],  // Oud Rose — cooling rose + warm oud

  // Incense
  873962401102: ['kapha'],      // Krishna Leela — stimulating/devotional
  842570161392: ['vata'],       // Meditation Incense — calming/grounding
  941184533442: ['vata'],       // Dharma Forest Flora — grounding/calming
  201779550862: ['pitta','kapha'], // Aarti Champa — both (floral + stimulating)
  899299327542: ['kapha'],      // Kailash — stimulating/sacred
  351852842992: ['kapha'],      // Karma — stimulating
  292062995472: ['pitta'],      // Rose Incense — cooling/floral
  559916447412: ['vata'],       // Tattva — grounding/elemental
  582266916492: ['vata'],       // Shanti — calming/peace
  250843368292: ['vata'],       // Shiva-Shakti (15g)
  610964356582: ['vata'],       // Shiva-Shakti (15g duplicate)
  960032540952: ['kapha'],      // Shri Ganesh — stimulating/auspicious
  821422424072: ['vata'],       // Shri Chandan (sandalwood) — grounding
  282036978882: ['kapha'],      // Amber Musk Incense — heavy/kapha
  801781847522: ['vata'],       // White Sage — cleansing/grounding

  // Spices and Seasonings
  989606849622: ['vata','kapha'],   // Ajwain Seeds — warming(vata) + pungent(kapha)
  592623266662: ['vata','kapha'],   // Ajwain Seeds 80g
  489550097542: ['pitta'],          // Anise Seeds (Saunf) — cooling/digestive pitta
  687756572442: ['vata'],           // Asafoetida Hing — warming/vata
  981435572242: ['vata'],           // Whole Cloves Laung — warming/vata
  909520178562: ['kapha'],          // Yellow Mustard Seeds — pungent/kapha
  373369898442: ['kapha'],          // Black Mustard Seeds — pungent/kapha
  690166698982: ['vata'],           // Dried Ground Ginger Saunth — warming/vata
  392139495702: ['vata'],           // Green Cardamom — warming/vata
  714798581662: ['vata'],           // Black Cardamom — warming/vata
  292019925782: ['pitta'],          // Coriander Powder — cooling/pitta
  284241221952: ['vata'],           // Cinnamon Sticks Dalchini — warming/vata
  280118676522: ['kapha'],          // Cumin Seeds — pungent/metabolic kapha
  756577176502: ['vata'],           // Whole Nutmeg Jaiphal — warming/vata
  133920066762: ['kapha'],          // Black Pepper Whole — pungent/kapha
  904080062232: ['kapha'],          // Black Pepper Ground — pungent/kapha
  755939769302: ['vata'],           // Chai Masala Spice Blend — warming/vata
  414782501922: ['kapha'],          // Himalayan Pink Salt — metabolic/kapha
  516163511472: ['pitta'],          // Black Himalayan Salt Kala Namak — cooling/pitta
  496527010942: ['pitta'],          // Dry Mango Powder Aamchur — sour/pitta cooling
  301149602502: ['pitta','kapha'],  // Turmeric Powder — anti-inf pitta + kapha
  590373852232: ['kapha'],          // Fenugreek Seeds Methi — metabolic/kapha
  938472626702: ['kapha'],          // Star Anise Badyan — pungent/kapha
  3497023432:   ['vata','kapha'],   // Maharaja All-Purpose Spice Blend — warming/mixed
  3497281516:   ['kapha'],          // Fish Spice Blend — heavy/kapha
  3497125057:   ['vata','kapha'],   // Paneer Spice Blend — warming spices
  3497158709:   ['vata'],           // Garam Masala Chai Spice Blend — warming/vata
  602554368:    ['kapha'],          // Black Cumin Seeds (Kalonji) — pungent/kapha

  // Dried fruits
  673116319262: ['vata'],           // Dried Guava — light/dry/vata
  428202278122: ['vata'],           // Dried Mango — warming/vata
  302250329642: ['vata'],           // Assorted Dried Fruits — nourishing/vata

  // Jaggery/Gur
  977829546712: ['vata'],           // Gur Granulated — nourishing/warming
  878096344172: ['vata'],           // Gur Pieces — nourishing/warming

  // Natural Aloe Vera Juices
  229782134822: ['pitta'],          // Natural Aloe Vera Juice with Pulp
  630844204552: ['pitta'],          // Natural Aloe Vera Juice
};

// ─── KEYWORD-BASED CLASSIFICATION ────────────────────────────────────────────
// Applied when no exact override exists.
// Returns array of doshas.
function classifyByKeywords(product) {
  const title   = (product.title_en || '').toLowerCase();
  const cats    = (product.category_en || []).join(' ').toLowerCase();
  const section = (product.section_en || '').toLowerCase();
  const concerns= (product.concerns   || []).join(' ').toLowerCase();
  const text    = `${title} ${cats} ${section} ${concerns}`;

  const doshas = new Set();

  // ── VATA cues ──
  if (has(text, 'ajwain','carom','hing','asafoetida')) doshas.add('vata');
  if (has(text, 'ginger','saunth')) doshas.add('vata');
  if (has(text, 'cardamom','elaichi')) doshas.add('vata');
  if (has(text, 'cinnamon','dalchini')) doshas.add('vata');
  if (has(text, 'clove','laung')) doshas.add('vata');
  if (has(text, 'nutmeg','jaiphal')) doshas.add('vata');
  if (has(text, 'chai masala')) doshas.add('vata');
  if (has(text, 'dashmula','dashamula')) doshas.add('vata');
  if (has(text, 'bala churna','bala tablet')) doshas.add('vata');
  if (has(text, 'kapikachhu')) doshas.add('vata');
  if (has(text, 'jatamansi')) doshas.add('vata');
  if (has(text, 'tagara')) doshas.add('vata');
  if (has(text, 'nagarmotha')) doshas.add('vata');
  if (has(text, 'haritaki')) doshas.add('vata');
  if (has(text, 'anantamul','anantha mul')) doshas.add('vata');
  if (has(text, 'shilajit','himalayan gold')) doshas.add('vata');
  if (has(text, 'shankhapushpi')) doshas.add('vata');
  if (has(text, 'sesame oil')) doshas.add('vata');
  if (has(text, 'mahanarayan','dosha massage oil')) doshas.add('vata');
  if (has(text, 'hair oil','mahabhringraj','kesh komal','sangamrit hair')) doshas.add('vata');
  if (has(text, 'bhringraj')) doshas.add('vata');
  if (has(text, 'dhatupaushtic')) doshas.add('vata');
  if (has(text, 'henna','hair colour')) doshas.add('vata');
  if (has(text, 'hair conditioner','hair mask')) doshas.add('vata');
  if (has(text, 'body lotion')) doshas.add('vata');
  if (has(text, 'jaggery','jaggery','gur ')) doshas.add('vata');
  if (has(text, 'dried mango','dried guava','dried fruit','assorted dried')) doshas.add('vata');
  if (has(text, 'joint care','shallaki')) doshas.add('vata');
  if (has(text, 'calci-cor','calci cor','calcium','bone')) doshas.add('vata');
  if (has(text, 'de-stress','destress','pro-sleep','shankhapushpi','pro-memory')) doshas.add('vata');
  if (has(text, 'men health','speman','confidex','vigor plus','kapikachhu')) doshas.add('vata');
  if (has(text, 'meditation incense','dhyana')) doshas.add('vata');
  if (has(text, 'sandalwood incense','shri chandan')) doshas.add('vata');
  if (has(text, 'white sage')) doshas.add('vata');
  if (has(text, 'shiva-shakti','shanti','tattva','dharma forest')) doshas.add('vata');
  if (has(text, 'sandalwood attar','sandalwood oil perfume')) doshas.add('vata');
  if (has(text, 'vanilla oil perfume','vanilla attar')) doshas.add('vata');
  if (has(text, 'amber oil perfume','amber attar')) doshas.add('vata');
  if (has(text, 'oud wood oil','white oud')) doshas.add('vata');
  if (has(text, 'ubtan','body scrub','face scrub')) doshas.add('vata');
  if (has(text, 'chyawanprash')) doshas.add('vata');
  if (has(text, 'jivan cream','jivan balm')) doshas.add('vata');
  if (has(text, 'sanzpazm')) doshas.add('vata');
  if (has(text, 'trishun')) doshas.add('vata');
  if (has(text, 'yogaraj guggul')) doshas.add('vata');
  if (has(text, 'turmeric-boswellia','boswellia')) doshas.add('vata');

  // ── PITTA cues ──
  if (has(text, 'amla','amalaki','gooseberry')) doshas.add('pitta');
  if (has(text, 'neem ')) doshas.add('pitta');
  if (has(text, 'manjistha')) doshas.add('pitta');
  if (has(text, 'giloy','guduchi')) doshas.add('pitta');
  if (has(text, 'bilva')) doshas.add('pitta');
  if (has(text, 'vasaka','vasa ')) doshas.add('pitta');
  if (has(text, 'aloe face gel','aloe vera face gel')) doshas.add('pitta');
  if (has(text, 'face toner','water toner')) doshas.add('pitta');
  if (has(text, 'face mask')) doshas.add('pitta');
  if (has(text, 'hydrolat')) doshas.add('pitta');
  if (has(text, 'rose water')) doshas.add('pitta');
  if (has(text, 'face gel')) doshas.add('pitta');
  if (has(text, 'aloe vera shower gel','aloe vera body wash')) doshas.add('pitta');
  if (has(text, 'soap ','glycerin soap','ayurvedic soap')) doshas.add('pitta');
  if (has(text, 'pro-liv','mentox')) doshas.add('pitta');
  if (has(text, 'kaishore guggul')) doshas.add('pitta');
  if (has(text, 'dermato care')) doshas.add('pitta');
  if (has(text, 'psorof')) doshas.add('pitta');
  if (has(text, 'women health','womens health','menophyt','breast care','pro-leukor')) doshas.add('pitta');
  if (has(text, 'eyexol')) doshas.add('pitta');
  if (has(text, 'serpenol')) doshas.add('pitta');
  if (has(text, 'aloe vera juice')) doshas.add('pitta');
  if (has(text, 'amla natural juice')) doshas.add('pitta');
  if (has(text, 'amla arjuna juice')) doshas.add('pitta');
  if (has(text, 'triphala juice')) doshas.add('pitta');
  if (has(text, 'noni juice')) doshas.add('pitta');
  if (has(text, 'all is well turmeric','turmeric juice')) doshas.add('pitta');
  if (has(text, 'coriander')) doshas.add('pitta');
  if (has(text, 'dry mango powder','aamchur')) doshas.add('pitta');
  if (has(text, 'black himalayan salt','kala namak','black salt')) doshas.add('pitta');
  if (has(text, 'toothpaste')) doshas.add('pitta');
  if (has(text, 'rose incense')) doshas.add('pitta');
  if (has(text, 'rose arabica attar','rose arabica oil')) doshas.add('pitta');
  if (has(text, 'lavender attar','lavender oil perfume')) doshas.add('pitta');
  if (has(text, 'lotus attar','lotus oil perfume')) doshas.add('pitta');
  if (has(text, 'saffron attar','saffron oil perfume')) doshas.add('pitta');
  if (has(text, 'neroli attar','neroli oil perfume')) doshas.add('pitta');
  if (has(text, 'indian rose oil','indian rose attar')) doshas.add('pitta');
  if (has(text, 'jasmine oil perfume','jasmine attar')) doshas.add('pitta');
  if (has(text, 'oud rose')) doshas.add('pitta');
  if (has(text, 'gastro care')) doshas.add('pitta');
  if (has(text, 'pyuren')) doshas.add('pitta');
  if (has(text, 'kumkumadi')) doshas.add('pitta');

  // ── KAPHA cues ──
  if (has(text, 'trikatu')) doshas.add('kapha');
  if (has(text, 'pippali','long pepper')) doshas.add('kapha');
  if (has(text, 'mustard seed','mustard yellow','mustard black','mustard oil')) doshas.add('kapha');
  if (has(text, 'kalonji','black seed','black cumin','nigella')) doshas.add('kapha');
  if (has(text, 'fenugreek','methi')) doshas.add('kapha');
  if (has(text, 'black pepper','kali mirch')) doshas.add('kapha');
  if (has(text, 'star anise','badyan')) doshas.add('kapha');
  if (has(text, 'cumin seed','zira')) doshas.add('kapha');
  if (has(text, 'himalayan pink salt','pink salt','pink namak')) doshas.add('kapha');
  if (has(text, 'medohar','medohar vati')) doshas.add('kapha');
  if (has(text, 'shape it slim','garcinia','slimness')) doshas.add('kapha');
  if (has(text, 'respi-ex','vasaka','vasak')) doshas.add('kapha');
  if (has(text, 'sitopaladi')) doshas.add('kapha');
  if (has(text, 'talisadi')) doshas.add('kapha');
  if (has(text, 'tulsi tablet','tulsi tablets','tulsi churna','tulsi leaf')) doshas.add('kapha');
  if (has(text, 'tinovit')) doshas.add('kapha');
  if (has(text, 'airolks')) doshas.add('kapha');
  if (has(text, 'giloy','guduchi')) doshas.add('kapha');
  if (has(text, 'moringa')) doshas.add('kapha');
  if (has(text, 'florabiotic','pro-septilin','immunosad','immunity booster','immunity plus')) doshas.add('kapha');
  if (has(text, 'karela churna','karela tablet','karela juice','karela jamun')) doshas.add('kapha');
  if (has(text, 'vijayasar')) doshas.add('kapha');
  if (has(text, 'diab-et','dialex','gudmar','gudmar patra')) doshas.add('kapha');
  if (has(text, 'cholestro','arjuna')) doshas.add('kapha');
  if (has(text, 'punarnava')) doshas.add('kapha');
  if (has(text, 'cysto')) doshas.add('kapha');
  if (has(text, 'hypothyro','kanchanar')) doshas.add('kapha');
  if (has(text, 'avipattikar','panchsakar','lavan bhaskar')) doshas.add('kapha');
  if (has(text, 'isabgol')) doshas.add('kapha');
  if (has(text, 'maha sudarshan')) doshas.add('kapha');
  if (has(text, 'vidanga')) doshas.add('kapha');
  if (has(text, 'bakuchi')) doshas.add('kapha');
  if (has(text, 'pro-piles','vercoz','vermicidol')) doshas.add('kapha');
  if (has(text, 'uric care')) doshas.add('kapha');
  if (has(text, 'krishna leela')) doshas.add('kapha');
  if (has(text, 'karma incense')) doshas.add('kapha');
  if (has(text, 'shri ganesh')) doshas.add('kapha');
  if (has(text, 'aarti champa')) doshas.add('kapha');
  if (has(text, 'amber musk incense')) doshas.add('kapha');
  if (has(text, 'kailash incense')) doshas.add('kapha');
  if (has(text, 'patchouli attar','patchouli oil')) doshas.add('kapha');
  if (has(text, 'black musk','musk al rijali','silver musk','white musk','nag champa')) doshas.add('kapha');
  if (has(text, 'sultan attar','sultan oil')) doshas.add('kapha');
  if (has(text, 'jannat ul firdaus')) doshas.add('kapha');
  if (has(text, 'black opium','black orchid','plum oil')) doshas.add('kapha');
  if (has(text, 'slimness tea','vigor herbal tea')) doshas.add('kapha');
  if (has(text, 'turmeric powder','haldi')) { doshas.add('pitta'); doshas.add('kapha'); }
  if (has(text, 'neem & tulsi shower gel','neem & tulsi aloe vera shower')) doshas.add('kapha');
  if (has(text, 'noni juice')) doshas.add('kapha');
  if (has(text, 'all in balance','garcinia')) doshas.add('kapha');
  if (has(text, 'immunity plus juice')) doshas.add('kapha');

  // ── Section-level fallbacks (when no keyword matched) ──
  if (doshas.size === 0) {
    if (section.includes('ayurveda')) {
      // Generic Ayurveda tablet — mixed
      if (concerns.includes('joints'))      doshas.add('vata');
      if (concerns.includes('stress'))      doshas.add('vata');
      if (concerns.includes('hair'))        doshas.add('vata');
      if (concerns.includes('womens'))      doshas.add('pitta');
      if (concerns.includes('skin'))        doshas.add('pitta');
      if (concerns.includes('digestion'))   doshas.add('kapha');
      if (concerns.includes('respiratory')) doshas.add('kapha');
      if (concerns.includes('immunity'))    doshas.add('kapha');
      if (concerns.includes('energy'))      doshas.add('vata');
    }
    if (section.includes('cosmetics')) {
      if (concerns.includes('hair'))  doshas.add('vata');
      if (concerns.includes('skin'))  doshas.add('pitta');
      if (concerns.includes('oral'))  doshas.add('pitta');
    }
    if (section.includes('food')) {
      doshas.add('vata'); // warming foods default to vata
    }
    if (section.includes('oils')) {
      doshas.add('vata'); // oils default to vata
    }
    if (section.includes('aromatherapy')) {
      if (concerns.includes('fragrance')) doshas.add('kapha'); // default heavy
    }
  }

  // Final failsafe — should never be reached, but ensures no 0-dosha product
  if (doshas.size === 0) doshas.add('vata');

  return [...doshas];
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const raw      = fs.readFileSync(CATALOG_PATH, 'utf8');
const catalog  = JSON.parse(raw);
const products = Array.isArray(catalog) ? catalog : (catalog.products || Object.values(catalog));

if (products.length !== 358) {
  console.error(`WARNING: Expected 358 products, found ${products.length}`);
}

const result  = {};
const totals  = { vata: 0, pitta: 0, kapha: 0 };

for (const p of products) {
  const id  = p.id;
  let doshas;

  if (OVERRIDES[id]) {
    doshas = unique(OVERRIDES[id]);
  } else {
    doshas = unique(classifyByKeywords(p));
  }

  if (doshas.length === 0) {
    console.warn(`FALLBACK: product ${id} "${p.title_en}" got no doshas — defaulting to vata`);
    doshas = ['vata'];
  }

  result[id] = doshas;
  for (const d of doshas) totals[d]++;
}

// Validate: all products have at least 1 dosha
const missing = products.filter(p => !result[p.id] || result[p.id].length === 0);
if (missing.length > 0) {
  console.error('ERROR: Products with 0 doshas:', missing.map(p => p.id));
}

// Write output
fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
console.log(`\nWrote ${Object.keys(result).length} products to ${OUT_PATH}`);
console.log('\nDosha counts:');
console.log(`  vata:  ${totals.vata}  products`);
console.log(`  pitta: ${totals.pitta} products`);
console.log(`  kapha: ${totals.kapha} products`);

// Print the full JSON to stdout as requested
console.log('\n--- doshas.json ---');
console.log(JSON.stringify(result, null, 2));
