/* eslint-disable */ 
import React, { StrictMode } from "react"; // import from react
import { Loader } from '@googlemaps/js-api-loader'

const API_KEY = process.env.GAPI
const initSqlJs = require('sql.js');
const fs = require('fs');
const ExcelJS = require('exceljs');

// latitude changes from north-south
// longitude changes from east-west
const west = { lng: 26.484543 }
const east = { lng: 26.610538 }
const north = { lat: -33.255697 }
const south = { lat: -33.373776 }
const cityCenter = { lat: -33.30422, lng: 26.53276 }

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

async function readExcel(headerRow, searchTerms) {
  const workbook = new ExcelJS.Workbook();
  //await workbook.xlsx.readFile('cases.xlsx');
  const raw = await fs.promises.readFile('cases.xlsx');
  await workbook.xlsx.load(raw.buffer);
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

function validateAddress(addr) {

}

const Status = Object.freeze({
  Loading: 1,
  Found: 2,
  NotFound: 3
});

export default class Example extends React.Component {
  constructor(props) {
    super(props);
    window.initMap = this.initMap.bind(this);
    this.state = {
      addresses: [],
      map: null,
      db: null,
    };
  }

  componentDidMount() {
    const loader = new Loader({
      apiKey: API_KEY,
      version: 'weekly'
    });
    loader.load().then(() => {
      const map = new google.maps.Map(document.getElementById('map'), {
        center: cityCenter,
        zoom: 13
      });
      this.setState({ map : map });
    });
    var filebuffer = null;
    if (fs.existsSync('spots.db')) {
      filebuffer = fs.readFileSync('spots.db');
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
      readExcel(3, [ ['Street', 'Address'], ['Test Date'] ])
      .then(v => {
        const ins = db.prepare("insert into location (original, whenfound) values (:orig, :when)");
        v.forEach(([addr,dt]) => ins.run({ ':orig': addr, ':when': dt ? dt.toISOString() : null }));
        const sel = db.prepare('select id, original, whenfound from location');
        var addrList = [];
        while (sel.step()) { addrList.push( Object.assign(sel.getAsObject(), { status: Status.Loading }) ) }
        this.setState({ addresses: addrList.sort((a,b) => a.whenfound < b.whenfound ? -1 : a.whenfound == b.whenfound ? 0 : 1) });
        console.log(addrList);
      });
    })
    .catch(err => console.log(err));
  }

  initMap() {
    this.setState({ map: new google.maps.Map(document.getElementById('map')) });
  }

  elemForStatus(status) {
    if (status == Status.Loading) {
      return <img src="loading.gif" style={{height: '1.2em'}} />
    }
    if (status == Status.Found) {
      return <span>✅</span>
    }
    if (status == Status.NotFound) {
      return <span>❌</span>
    }
  }

  render() {
    // all Components must have a render method
    return (
      <div style={{ flex: 1, justifyContent: "left", backgroundColor: "#6d2077", overflowY: 'hidden' }}>
        {/* all your other components go here*/}
        <div style={{ height: "50vh" }} id="map"></div>
        <div style={{ height: '50vh' }}>
          <div style={{ margin: '4px' }}>{this.state.addresses.length} addresses known.</div>
          <div style={{ overflowY: 'auto', height: '45vh' }}>
            <ul>
            {
              this.state.addresses.map((v) => v ? <li>{v.original} {this.elemForStatus(v.status)}</li> : <li>Nope.</li>)
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
