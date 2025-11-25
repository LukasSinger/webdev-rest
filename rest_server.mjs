import * as path from "node:path";
import * as url from "node:url";

import { default as express } from "express";
import { default as sqlite3 } from "sqlite3";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const db_filename = path.join(__dirname, "db", "stpaul_crime.sqlite3");

const port = 8000;

let app = express();
app.use(express.json());

/********************************************************************
 ***   DATABASE FUNCTIONS                                         ***
 ********************************************************************/
// Open SQLite3 database (in read-write mode)
let db = new sqlite3.Database(db_filename, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.log("Error opening " + db_filename);
    } else {
        console.log("Now connected to " + path.basename(db_filename));
    }
});

// Create Promise for SQLite3 database SELECT query
function dbSelect(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Create Promise for SQLite3 database INSERT or DELETE query
function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}
function formatTime(dateStr) {
    const date = new Date(dateStr);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
}
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
}
/********************************************************************
 ***   REST REQUEST HANDLERS                                      ***
 ********************************************************************/
// GET request handler for crime codes
app.get("/codes", async (req, res) => {
    let codes = req.query["code"];
    if (codes) codes = codes.split(",");
    let data;
    try {
        data = await dbSelect("SELECT * FROM Codes");
    } catch (err) {
        console.error(err);
        res.status(500).type("text/html").send("500 Internal Server Error");
        return;
    }
    const resData = [];
    for (const entry of data) {
        if (!codes || codes.includes(entry["code"].toString())) {
            resData.push({
                code: entry["code"],
                type: entry["incident_type"]
            });
        }
    }
    if (resData.length > 0) res.status(200).type("json").send(resData);
    else res.status(404).type("text/html").send("404 Not Found");
});

// GET request handler for neighborhoods
app.get("/neighborhoods", (req, res) => {
    console.log(req.query); // query object (key-value pairs after the ? in the url)

    res.status(200).type("json").send({}); // <-- you will need to change this
});

// GET request handler for crime incidents
app.get("/incidents", (req, res) => {
    console.log(req.query);
    let whereParts = [];
    let params = [];
    let query = "SELECT * FROM Incidents";
    let limit = 1000;
    if ("start_date" in req.query) {
        whereParts.push("DATE(date_time) >= DATE(?)");
        params.push(req.query["start_date"]);
    }
    if ("end_date" in req.query) {
        whereParts.push("DATE(date_time) <= DATE(?)");
        params.push(req.query["end_date"]);
    }
    if ("code" in req.query) {
        let safe_codes = req.query["code"]
            .split(",")
            .map((c) => parseInt(c))
            .join(", ");
        whereParts.push(`code in (${safe_codes})`);
    }
    if ("grid" in req.query) {
        let safe_grid = req.query["grid"]
            .split(",")
            .map((g) => parseInt(g))
            .join(", ");
        whereParts.push(`police_grid in (${safe_grid})`);
    }
    if ("neighborhood" in req.query) {
        let safe_neighborhood = req.query["neighborhood"]
            .split(",")
            .map((n) => parseInt(n))
            .join(", ");
        whereParts.push(`neighborhood_number in (${safe_neighborhood})`);
    }
    if ("limit" in req.query) {
        limit = req.query["limit"];
    }
    if (whereParts.length > 0) {
        query += " WHERE " + whereParts.join(" AND ");
    }
    query += " ORDER BY date_time";
    query += " LIMIT ?";
    params.push(limit);
    console.log(query, params);
    dbSelect(query, params)
        .then((rows) => {
            let response = [];
            for (let row of rows) {
                response.push({
                    case_number: row["case_number"],
                    date: formatDate(row["date_time"]),
                    time: formatTime(row["date_time"]),
                    code: row["code"],
                    incident: row["incident"],
                    police_grid: row["police_grid"],
                    neighborhood_number: row["neighborhood_number"],
                    block: row["block"]
                });
            }
            res.status(200).type("json").send(JSON.stringify(response, null, 2));
        })
        .catch((err) => {
            console.log(err);
            res.status(400).type("txt").send("Invalid request");
        });
});

// PUT request handler for new crime incident
app.put("/new-incident", (req, res) => {
    console.log(req.body); // uploaded data

    res.status(200).type("txt").send("OK"); // <-- you may need to change this
});

// DELETE request handler for new crime incident
app.delete("/remove-incident", async (req, res) => {
    console.log(req.body); // uploaded data
    const number = req.body["case_number"];
    dbSelect("select * from Incidents where case_number=?", [number])
        .then((rows) => {
            if (rows.length == 0) {
                throw "Invalid case number";
            }
            return dbRun("delete from Incidents where case_number=?", [number]);
        })
        .then(() => {
            res.status(200).type("txt").send("OK");
        })
        .catch((err) => {
            res.status(500).type("txt").send(err);
        });
});

/********************************************************************
 ***   START SERVER                                               ***
 ********************************************************************/
// Start server - listen for client connections
app.listen(port, () => {
    console.log("Now listening on port " + port);
});
