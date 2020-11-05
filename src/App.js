/* eslint-disable */ 
import React from "react"; // import from react

const API_KEY = process.env.GAPI
const initSqlJs = require('sql.js');
const fs = require('fs');
const ExcelJS = require('exceljs');

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

async function readExcel(headerRow) {
  const workbook = new ExcelJS.Workbook();
  //await workbook.xlsx.readFile('cases.xlsx');
  const raw = await fs.promises.readFile('cases.xlsx');
  await workbook.xlsx.load(raw.buffer);
  const worksheet = workbook.worksheets[0];
  const column = findColumn(worksheet, headerRow, ['Address', 'Street']);
  if (column == null) {
    return [];
  }
  console.log(`Found addresses in column ${" ABCDEFGHIJKLMNOPQRSTUVWXYZ"[column]}.`);
  var out = [];
  worksheet.getColumn(column).eachCell((cell, rowNumber) => {
    if (rowNumber > headerRow && cell.value) {
      out.push(cell.value);
    }
  });
  return out;
}

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
    var filebuffer = null;
    if (fs.existsSync('db.sqlite3')) {
      filebuffer = fs.readFileSync('db.sqlite3');
    }
    initSqlJs({
      locateFile: file => `./${file}`
    })
    .then(sql => {
      const db = filebuffer ? new sql.Database(filebuffer) : new sql.Database();
      console.log('Connected to DB.');
      this.setState({db : db});
      readExcel(3)
      .then(v => {
        console.log(v);
        const read = v.map(w => { return {key: w, value: w} });
        this.setState({ addresses: read });
      });    
    })
    .catch(err => console.log(err));
  }

  initMap() {
    this.setState({ map: new google.maps.Map(document.getElementById('map')) });
  }

  render() {
    // all Components must have a render method
    return (
      <div style={{ flex: 1, justifyContent: "left", backgroundColor: "#6d2077" }}>
        {/* all your other components go here*/}
        <div style={{height: "50vh"}} id="map"></div>
        <ul>
        {
          this.state.addresses.map((v) => v ? <li>{v.value}</li> : <li>Nope.</li>)
        }
        </ul>
      </div>
    );
  }

}
