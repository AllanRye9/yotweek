import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })
const COUNTRY_COORDS = {
  AF:[33,65],AL:[41,20],DZ:[28,3],AD:[42.5,1.5],AO:[-11.5,17.5],AG:[17.1,-61.8],AR:[-34,-64],
  AM:[40,45],AU:[-25,135],AT:[47.3,13.3],AZ:[40.3,47.6],BS:[25,-77.5],BH:[26,50.5],BD:[24,90],
  BB:[13.2,-59.6],BY:[53,28],BE:[50.8,4],BZ:[17.3,-88.5],BJ:[9.3,2.3],BT:[27.5,90.5],BO:[-17,-65],
  BA:[44,17],BW:[-22,24],BR:[-10,-55],BN:[4.5,114.7],BG:[43,25],BF:[13,-2],BI:[-3.5,30],
  CV:[16,-24],KH:[13,105],CM:[6,12],CA:[60,-95],CF:[7,21],TD:[15,19],CL:[-30,-71],CN:[35,105],
  CO:[4,-72],KM:[-11.6,43.3],CD:[-4,24],CG:[-1,15],CR:[10,-84],HR:[45.2,15.5],CU:[22,-80],
  CY:[35,33],CZ:[49.8,15.5],DK:[56,10],DJ:[11.5,43],DM:[15.4,-61.4],DO:[19,-70.7],EC:[-2,-77.5],
  EG:[27,30],SV:[14,-88.9],GQ:[2,10],ER:[15,39],EE:[59,26],SZ:[-26.5,31.5],ET:[8,38],
  FJ:[-18,178],FI:[64,26],FR:[46,2],GA:[-1,11.8],GM:[13.5,-15.5],GE:[42,43.5],DE:[51,9],
  GH:[8,-2],GR:[39,22],GD:[12.1,-61.7],GT:[15.5,-90.3],GN:[11,-11.8],GW:[12,-15],GY:[5,-59],
  HT:[19,-72.4],HN:[15,-86.5],HU:[47,20],IS:[65,-18],IN:[20,77],ID:[-5,120],IR:[32,53],
  IQ:[33,44],IE:[53,-8],IL:[31.5,35],IT:[42.8,12.8],JM:[18.2,-77.5],JP:[36,138],JO:[31,36],
  KZ:[48,68],KE:[1,38],KI:[1.4,173],KP:[40,127],KR:[37,128],KW:[29.5,47.8],KG:[41,75],
  LA:[18,105],LV:[57,25],LB:[33.8,35.8],LS:[-29.5,28.5],LR:[6.5,-9.5],LY:[25,17],
  LI:[47.1,9.5],LT:[56,24],LU:[49.7,6.2],MG:[-20,47],MW:[-13.5,34],MY:[2.5,112.5],
  MV:[3,73],ML:[17,-4],MT:[36,14.4],MH:[9,168],MR:[20,-12],MU:[-20.3,57.5],MX:[23,-102],
  FM:[7,158],MD:[47,29],MC:[43.7,7.4],MN:[46,105],ME:[42.5,19.3],MA:[32,-5],MZ:[-18,35],
  MM:[22,96],NA:[-22,17],NR:[-0.5,167],NP:[28,84],NL:[52.3,5.3],NZ:[-41,174],NI:[13,-85],
  NE:[17,8],NG:[10,8],NO:[62,10],OM:[22,57],PK:[30,70],PW:[7.5,134.5],PS:[31.9,35.2],
  PA:[9,-80],PG:[-6,147],PY:[-23,-58],PE:[-10,-76],PH:[13,122],PL:[52,20],PT:[39.5,-8],
  QA:[25.5,51.2],RO:[46,25],RU:[60,100],RW:[-2,30],KN:[17.3,-62.7],LC:[13.9,-60.9],
  VC:[13.2,-61.2],WS:[-13.6,-172.5],SM:[43.9,12.5],ST:[1,7],SA:[25,45],SN:[14,-14],
  RS:[44,21],SC:[-4.7,55.5],SL:[8.5,-11.5],SG:[1.3,103.8],SK:[48.7,19.5],SI:[46,15],
  SB:[-8,159],SO:[10,49],ZA:[-29,25],SS:[7,30],ES:[40,-4],LK:[7,81],SD:[15,30],
  SR:[4,-56],SE:[62,15],CH:[47,8],SY:[35,38],TW:[23.7,121],TJ:[39,71],TZ:[-6,35],
  TH:[15,101],TL:[-8.5,125.6],TG:[8,1.2],TO:[-20,-175],TT:[11,-61],TN:[34,9],TR:[39,35],
  TM:[40,60],UG:[1,32],UA:[49,32],AE:[24,54],GB:[54,-2],US:[38,-97],UY:[-33,-56],
  UZ:[41,64],VU:[-16,167],VE:[8,-66],VN:[16,108],YE:[15,48],ZM:[-15,30],ZW:[-20,30],
  // extra
  HK:[22.3,114.2],MO:[22.2,113.5],PR:[18.2,-66.5],TF:[-49.3,69.4],
}

function countryNameToCode(name) {
  // Simple lookup table for common country names
  const map = {
    'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Andorra':'AD','Angola':'AO',
    'Argentina':'AR','Armenia':'AM','Australia':'AU','Austria':'AT','Azerbaijan':'AZ',
    'Bahrain':'BH','Bangladesh':'BD','Belarus':'BY','Belgium':'BE','Belize':'BZ',
    'Benin':'BJ','Bhutan':'BT','Bolivia':'BO','Bosnia and Herzegovina':'BA','Botswana':'BW',
    'Brazil':'BR','Brunei':'BN','Bulgaria':'BG','Burkina Faso':'BF','Burundi':'BI',
    'Cambodia':'KH','Cameroon':'CM','Canada':'CA','Chad':'TD','Chile':'CL','China':'CN',
    'Colombia':'CO','Croatia':'HR','Cuba':'CU','Cyprus':'CY','Czech Republic':'CZ',
    'Czechia':'CZ','Denmark':'DK','Ecuador':'EC','Egypt':'EG','El Salvador':'SV',
    'Eritrea':'ER','Estonia':'EE','Ethiopia':'ET','Finland':'FI','France':'FR',
    'Gabon':'GA','Georgia':'GE','Germany':'DE','Ghana':'GH','Greece':'GR',
    'Guatemala':'GT','Guinea':'GN','Haiti':'HT','Honduras':'HN','Hungary':'HU',
    'Iceland':'IS','India':'IN','Indonesia':'ID','Iran':'IR','Iraq':'IQ','Ireland':'IE',
    'Israel':'IL','Italy':'IT','Jamaica':'JM','Japan':'JP','Jordan':'JO',
    'Kazakhstan':'KZ','Kenya':'KE','Kuwait':'KW','Kyrgyzstan':'KG','Laos':'LA',
    'Latvia':'LV','Lebanon':'LB','Lesotho':'LS','Libya':'LY','Lithuania':'LT',
    'Luxembourg':'LU','Madagascar':'MG','Malawi':'MW','Malaysia':'MY','Maldives':'MV',
    'Mali':'ML','Malta':'MT','Mauritania':'MR','Mauritius':'MU','Mexico':'MX',
    'Moldova':'MD','Mongolia':'MN','Montenegro':'ME','Morocco':'MA','Mozambique':'MZ',
    'Myanmar':'MM','Burma':'MM','Namibia':'NA','Nepal':'NP','Netherlands':'NL',
    'New Zealand':'NZ','Nicaragua':'NI','Niger':'NE','Nigeria':'NG','Norway':'NO',
    'Oman':'OM','Pakistan':'PK','Panama':'PA','Papua New Guinea':'PG','Paraguay':'PY',
    'Peru':'PE','Philippines':'PH','Poland':'PL','Portugal':'PT','Qatar':'QA',
    'Romania':'RO','Russia':'RU','Russian Federation':'RU','Rwanda':'RW',
    'Saudi Arabia':'SA','Senegal':'SN','Serbia':'RS','Sierra Leone':'SL',
    'Singapore':'SG','Slovakia':'SK','Slovenia':'SI','Somalia':'SO',
    'South Africa':'ZA','South Sudan':'SS','Spain':'ES','Sri Lanka':'LK',
    'Sudan':'SD','Sweden':'SE','Switzerland':'CH','Syria':'SY','Taiwan':'TW',
    'Tajikistan':'TJ','Tanzania':'TZ','Thailand':'TH','Togo':'TG','Tunisia':'TN',
    'Turkey':'TR','Turkmenistan':'TM','Uganda':'UG','Ukraine':'UA',
    'United Arab Emirates':'AE','UAE':'AE','United Kingdom':'GB','UK':'GB',
    'United States':'US','USA':'US','United States of America':'US',
    'Uruguay':'UY','Uzbekistan':'UZ','Venezuela':'VE','Vietnam':'VN',
    'Viet Nam':'VN','Yemen':'YE','Zambia':'ZM','Zimbabwe':'ZW',
    'Hong Kong':'HK','Macau':'MO','Puerto Rico':'PR',
    'Kosovo':'RS','Palestine':'PS','Palestinian Territory':'PS',
  }
  return map[name] || null
}

export default function VisitorMap({ visitorCountries = [], downloadCountries = [] }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)

  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return

    const map = L.map(mapRef.current, {
      center:  [20, 10],
      zoom:    2,
      minZoom: 1,
      maxZoom: 6,
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    instanceRef.current = map
    return () => {
      map.remove()
      instanceRef.current = null
    }
  }, [])

  // Re-draw pins whenever data changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    // Remove old circle markers
    map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer) })

    const combined = {}
    visitorCountries.forEach(({ country, count }) => {
      const code = countryNameToCode(country) || country
      if (!combined[code]) combined[code] = { country, visitors: 0, downloads: 0, code }
      combined[code].visitors += count
    })
    downloadCountries.forEach(({ country, count }) => {
      const code = countryNameToCode(country) || country
      if (!combined[code]) combined[code] = { country, visitors: 0, downloads: 0, code }
      combined[code].downloads += count
    })

    Object.values(combined).forEach(({ country, visitors, downloads, code }) => {
      const coords = COUNTRY_COORDS[code]
      if (!coords) return
      const total  = visitors + downloads
      const radius = Math.max(5, Math.min(28, 5 + Math.log2(total + 1) * 3.5))
      const color  = downloads > 0 ? '#ef4444' : '#3b82f6'

      L.circleMarker(coords, {
        radius,
        fillColor:   color,
        color:       '#fff',
        weight:      1.5,
        opacity:     0.9,
        fillOpacity: 0.7,
      })
        .bindPopup(
          `<div style="min-width:120px">
            <strong style="font-size:13px">${country}</strong><br/>
            ${visitors  ? `<span style="color:#60a5fa">👥 ${visitors} visitor${visitors !== 1 ? 's' : ''}</span><br/>` : ''}
            ${downloads ? `<span style="color:#f87171">📥 ${downloads} download${downloads !== 1 ? 's' : ''}</span>` : ''}
          </div>`
        )
        .addTo(map)
    })
  }, [visitorCountries, downloadCountries])

  return (
    <div style={{ position: 'relative' }}>
      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 10, zIndex: 900,
        background: 'rgba(17,24,39,0.85)', borderRadius: 8,
        padding: '6px 10px', fontSize: '0.72rem', color: '#d1d5db',
        display: 'flex', gap: 12, backdropFilter: 'blur(4px)',
        border: '1px solid rgba(75,85,99,0.5)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          Downloads
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
          Visitors only
        </span>
      </div>
      <div ref={mapRef} style={{ height: 380, borderRadius: 12, overflow: 'hidden', background: '#1a2233' }} />
    </div>
  )
}
