/* eslint-disable */ 
import React, { StrictMode } from "react"; // import from react
//import { Loader } from '@googlemaps/js-api-loader'

//const API_KEY = process.env.GAPI
const initSqlJs = require('sql.js');
const fs = require('fs');
const ExcelJS = require('exceljs');
const dbFile = 'spots.db';
const geocodeRateLimitMS = 1100;

const google = window.google;

/*
const loader = new Loader({
  apiKey: API_KEY,
  version: 'weekly'
});
*/

const Status = Object.freeze({
  Loading: 1,
  Geocoded: 2,
  NotFound: 3
});

// latitude changes from north-south
// longitude changes from east-west
const west = { lng: 26.484543 }
const east = { lng: 26.610538 }
const north = { lat: -33.255697 }
const south = { lat: -33.373776 }
const cityCenter = { lat: -33.30422, lng: 26.53276 }
let bounds;

function findColumn(worksheet, headerRow, header) {
  const row = worksheet.getRow(headerRow);
  var i = 1;
  for (; i<256; i++) {
    if (header.includes(row.getCell(i).value)) {
      return i;
    }
  }
  return null;
}

async function readExcel(headerRow, searchTerms, workbook) {
  //const workbook = new ExcelJS.Workbook();
  //await workbook.xlsx.readFile('cases.xlsx');
  //const raw = await fs.promises.readFile('cases.xlsx');
  //await workbook.xlsx.load(raw.buffer);
  const worksheet = workbook.worksheets[0];
  const columns = searchTerms.map((st) => findColumn(worksheet, headerRow, st));
  if (columns.some((x) => x == null)) {
    return [];
  }
  var out = [];
  columns.map((column) => {
    console.log(`Found data in column ${" ABCDEFGHIJKLMNOPQRSTUVWXYZ"[column]}.`);
    const outLen = out.length;
    var i = 0;
    worksheet.getColumn(column).eachCell((cell, rowNumber) => {
      if (rowNumber > headerRow) {
        if (i < outLen) {
          out[i].push(cell.value);
        } else {
          out.push([cell.value]);
        }
        i++;
      }
    })
  });
  return out;
}

var bucket = 0;

function generateTokens() {
  if (bucket < 3) bucket++;
  setTimeout(generateTokens, geocodeRateLimitMS);
}

function validateDatum(db, datum, done) {
  if (datum.status != Status.Loading) {
    return;
  }
  const suffixes = [
    '',
    ', Grahamstown',
    ', Grahamstown 6140',
    ', Grahamstown, 6140',
    ', Grahamstown 6140, Eastern Cape',
    ', Grahamstown 6140, South Africa',
    ', Grahamstown 6140, Eastern Cape, South Africa',
    ', Makhanda',
    ', Makhanda 6140',
    ', Makhanda, 6140',
    ', Makhanda 6140, Eastern Cape',
    ', Makhanda 6140, South Africa',
    ', Makhanda 6140, Eastern Cape, South Africa'
  ];
  const geocoder = new google.maps.Geocoder();
  function tryWithSuffix(rest) {
    if (bucket > 0) {
      bucket--;
      //console.log(`Taken a token, remaining: ${bucket}`);
    } else {
      setTimeout(() => tryWithSuffix(rest), 1000);
      return;
    }
    if (rest.length == 0) {
      console.log(`Geocode FAILED for base '${datum.original}'.`);
      //datum.status = Status.NotFound;
      done(datum.id);
    }
    const candidate = datum.original + rest[0];
    geocoder.geocode( { 'address': candidate, 'bounds': bounds, 'region': 'za' }, (results, status) => {
      if (status == 'OK') {
        const statement = db.prepare("update location set lat=:lat, lng=:lng, verified=:ver where id=:id");
        statement.run({
          ':lat': results[0].geometry.location.lat(),
          ':lng': results[0].geometry.location.lng(),
          ':ver': candidate,
          ':id': datum.id
        });        
        //datum.status = Status.Geocoded;
        console.log(`Geocoded: ${datum.original} ---AS---> ${candidate}`);
        persist(db);
        done(datum.id);
      } else {
        console.log(`Geocode unsuccessful for '${candidate}': ${status}`);
        tryWithSuffix(rest.slice(1));
      }
    });
  }
  tryWithSuffix(suffixes);
}

function validateData(db, data, done) {
  data.map((v) => validateDatum(db, v, done));
}

function persist(db) {
  const binary = db.export();
  const buffer = Buffer.from(binary);
  fs.writeFileSync(dbFile, buffer);
}

function statusFor(loading, o) {
  if (o.lat || o.lng) {
    return Status.Geocoded;
  }
  if (loading.includes(o.id)) {
    return Status.Loading;
  }
  return Status.NotFound;
}


export default class Example extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      addresses: [],
      map: null,
      db: null,
      mapShapes: [],
      loading: [], // ids that are still being assessed
    };
  }

  updateLoadingFromDB(db) {
    const selIds = db.prepare("select id from location");
    var initialLoading = [];
    while (selIds.step()) { initialLoading.push(selIds.get()[0]); }
    this.setState({loading: initialLoading});
  }

  uploadFile() {
    const reader = new FileReader();
    var file = document.getElementById('xlsxFile');
    reader.readAsArrayBuffer(file.files[0]);
    reader.onload = () => {
      const buffer = reader.result;
      const workbook = new ExcelJS.Workbook();
      workbook.xlsx.load(buffer).then(workbook => {
        readExcel(3, [ ['Street', 'Address'], ['Test Date'] ], workbook)
        .then(v => {
          // do insertions
          const ins = this.state.db.prepare("insert into location (original, whenfound) values (:orig, :when)");
          v.forEach(([addr,dt]) => ins.run({ ':orig': addr, ':when': dt ? dt.toISOString() : null }));
          this.updateLoadingFromDB(this.state.db);
          this.updateAddresses((o) => statusFor(this.state.loading, o));
          validateData(this.state.db, this.state.addresses, (v) => {
            const newLoading = this.state.loading.filter(x => x.id != v);
            this.setState({loading: newLoading});
            this.updateAddresses((o) => statusFor(newLoading, o));
          });
        });
      })
    };
  }
  
  updateAddresses(statusFunc) {
    const sel = this.state.db.prepare('select id, original, whenfound, lat, lng from location');
    var addrList = [];
    var loading = [];
    while (sel.step()) {
      const o = sel.getAsObject();
      const status = statusFunc(o);
      addrList.push( Object.assign(o, { status: status }) );
      if (status == Status.Loading) {
        loading.push(o.id);
      }
    }
    this.setState({ addresses: addrList.sort((a,b) => a.whenfound < b.whenfound ? -1 : a.whenfound == b.whenfound ? 0 : 1), loading: loading });
    var newShapes = this.state.mapShapes.slice();
    addrList.forEach(({id,lat,lng,status}) => {
      if (status == Status.Geocoded && newShapes.findIndex(({ids}) => ids.includes(id)) == -1) {
        const foundIdx = newShapes.findIndex(({key}) => key.lat == lat && key.lng == lng);
        if (foundIdx == -1) {
          const c = new google.maps.Circle({
            strokeColor: '#ff0000',
            strokeOpacity: 0.4,
            strokeWeight: 1,
            fillColor: '#ff0000',
            fillOpacity: 0.05,
            map: this.state.map,
            center: {lat: lat, lng: lng},
            radius: 15, // in meters
          });
          newShapes.push({key: {lat:lat, lng:lng}, shape: c, ids: [id]});
        } else {
          const currentRadius = newShapes[foundIdx].shape.getRadius();
          newShapes[foundIdx].shape.setRadius(currentRadius+10);
          newShapes[foundIdx].ids.push(id);
        }
      }
    });
    this.setState({ mapShapes: newShapes });
    //console.log(addrList);
  }

  componentDidMount() {
    generateTokens();
    const map = new google.maps.Map(document.getElementById('map'), {
      center: cityCenter,
      zoom: 13,
    });
    bounds = new google.maps.LatLngBounds({lat: south.lat, lng:west.lng}, {lat:north.lat, lng:east.lng});
    this.setState({ map : map });
    var filebuffer = null;
    if (fs.existsSync(dbFile)) {
      filebuffer = fs.readFileSync(dbFile);
    }
    initSqlJs({
      locateFile: file => `./${file}`
    })
    .then(sql => {
      // create table if not exists location ( id integer primary key autoincrement, original text, verified text, lat real, lng real, whenfound text )
      const db = filebuffer ? new sql.Database(filebuffer) : new sql.Database();
      console.log('Connected to DB.');
      db.run('create table if not exists location ( id integer primary key autoincrement, original text, verified text, lat real, lng real, whenfound text )');
      this.setState({db : db});
      this.updateAddresses((o) => o.lat || o.lng ? Status.Geocoded : Status.Loading);
      validateData(this.state.db, this.state.addresses, (v) => {
        const newLoading = this.state.loading.filter(x => x.id != v);
        this.setState({loading: newLoading});
        this.updateAddresses((o) => statusFor(newLoading, o));
      });
})
    .catch(err => console.log(err));
  }

  elemForStatus(status) {
    if (status == Status.Loading) {
      return <img src="loading.gif" style={{height: '1.2em'}} />
    }
    if (status == Status.Geocoded) {
      return <span>✅</span>
    }
    if (status == Status.NotFound) {
      return <span>❌</span>
    }
  }

  listEntry(v) {
    if (!v) {
      return <li>Nope.</li>;
    }
    if (v.status == Status.Loading || v.status == Status.NotFound) {
      return <li>{v.original} {this.elemForStatus(v.status)}</li>;
    }
    if (v.status == Status.Geocoded) {
      if (v.verified != v.original) {
        return <li><span style={{textDecoration: 'line-through'}}>{v.original}</span> {this.elemForStatus(v.status)} {v.verified}</li>;
      } else {
        return <li>{v.original} {this.elemForStatus(v.status)}</li>;
      }
    }
  }

  render() {
    // all Components must have a render method
    //validateData(this.state.db, this.state.addresses, this.forceUpdate);
    return (
      <div style={{ flex: 1, justifyContent: "left", backgroundColor: "#6d2077aa", overflowY: 'hidden' }}>
        {/* all your other components go here*/}
        <div style={{ height: "50vh" }} id="map"></div>
        <div style={{ height: '50vh' }}>
          <div>
            <label htmlFor="xlsxFile">Upload a file with NEW entries: </label>
            <input type="file" name="xlsx" id="xlsxFile" />
            <button type="submit" onClick={() => this.uploadFile()}>Upload XLSX (Excel) file</button>
          </div>
          <div style={{ margin: '4px' }}>{this.state.addresses.length} addresses known.  {this.state.loading.length} remain to be mapped.</div>
          <div style={{ overflowY: 'auto', height: '42vh' }}>
            <ul>
            {
              this.state.addresses.map((v) => this.listEntry(v))
            }
            </ul>
          </div>
          <footer style={{paddingLeft: '5px', paddingRight: '5px'}}>
            Loading image by R M Media Ltd (<a href="https://creativecommons.org/licenses/by-sa/3.0/deed.en">CC-BY-SA 3.0</a>)
          </footer>
        </div>
      </div>
    );
  }

}
