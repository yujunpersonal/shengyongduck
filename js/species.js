/* Species and environment data — values from the design system's Species and Environments sections (approx.). */
window.DuckFlight = window.DuckFlight || {};

DuckFlight.SPECIES = {
  mallard:  { name:'Mallard', short:'Mallard', size:1, hz:5.6, speed:1, kmh:70, neck:1, tail:1, bill:1,
              head:'plumage-mallard-head', body:'plumage-mallard-body', breast:'plumage-mallard-breast',
              wing:'plumage-wing-grey', spec:'plumage-speculum-blue', billc:'plumage-bill-yellow',
              erratic:.2, glide:.15, circles:true, flock:[1,4] },
  pintail:  { name:'Northern Pintail', short:'Pintail', size:1.02, hz:5, speed:1.15, kmh:78, neck:1.6, tail:2.3, bill:.95,
              head:'plumage-pintail-head', body:'plumage-pintail-body', breast:'plumage-pale-breast',
              wing:'plumage-wing-grey', spec:'plumage-speculum-bronze', billc:'plumage-bill-slate',
              erratic:.15, glide:.5, whiffle:true, flock:[2,5] },
  gadwall:  { name:'Gadwall', short:'Gadwall', size:.9, hz:6, speed:1.05, kmh:72, neck:1, tail:1, bill:.9,
              head:'plumage-gadwall-head', body:'plumage-gadwall-body', breast:'plumage-gadwall-body',
              wing:'plumage-wing-grey', spec:'plumage-speculum-white', billc:'plumage-bill-dark',
              erratic:.2, glide:.1, circles:true, flock:[1,4] },
  wigeon:   { name:'American Wigeon', short:'Wigeon', size:.85, hz:6.6, speed:1.1, kmh:75, neck:.9, tail:1.15, bill:.7,
              head:'plumage-wigeon-head', body:'plumage-wigeon-flank', breast:'plumage-wigeon-flank',
              wing:'plumage-wing-grey', spec:'plumage-speculum-green', billc:'plumage-bill-slate',
              erratic:.55, glide:.05, shared:true, forewing:true, flock:[3,8] },
  teal:     { name:'Green-winged Teal', short:'Teal', size:.62, hz:8.2, speed:1.2, kmh:72, neck:.9, tail:1, bill:.8,
              head:'plumage-teal-head', body:'plumage-gadwall-body', breast:'plumage-pale-breast',
              wing:'plumage-wing-grey', spec:'plumage-speculum-green', billc:'plumage-bill-dark',
              erratic:.8, glide:0, shared:true, flock:[4,10] },
  shoveler: { name:'Northern Shoveler', short:'Shoveler', size:.86, hz:6, speed:1, kmh:70, neck:.95, tail:1, bill:1.7,
              head:'plumage-mallard-head', body:'plumage-shoveler-flank', breast:'plumage-pale-breast',
              wing:'plumage-shoveler-forewing', spec:'plumage-speculum-green', billc:'plumage-bill-dark',
              erratic:.15, glide:.1, circles:true, flock:[1,4] }
};

/* mix = relative weights of [flush, pass-over, drop-in] */
DuckFlight.ENVIRONMENTS = {
  wetland: { name:'Wetland', top:'env-wetland-sky-top', low:'env-wetland-sky-low', water:'env-wetland-water', veg:'env-wetland-reed',
             horizon:.56, reeds:1, cattails:true, trees:14, clouds:.8, mix:[.12,.84,.04] },
  lake:    { name:'Lake', top:'env-lake-sky-top', low:'env-lake-sky-low', water:'env-lake-water', veg:'env-lake-shore',
             horizon:.5, reeds:.3, trees:30, conifers:true, clouds:.5, mix:[.12,.84,.04] },
  dusk:    { name:'Marsh at dusk', top:'env-dusk-sky-top', low:'env-dusk-sky-low', water:'env-dusk-water', veg:'env-dusk-reed',
             horizon:.6, reeds:1.15, cattails:true, trees:12, sun:true, clouds:.6, silhouette:.55, mix:[.12,.84,.04] },
  field:   { name:'Flooded field', top:'env-field-sky-top', low:'env-field-sky-low', water:'env-field-water', veg:'env-field-stubble',
             horizon:.54, reeds:.6, stubble:true, trees:10, clouds:1, mix:[.12,.84,.04] }
};
