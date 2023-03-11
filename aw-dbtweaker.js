import { Client, Databases, Query } from 'node-appwrite'
import { config as config_env } from 'dotenv'
import getopt from 'node-getopt'

const ACT_LIST = 'list'
const ACT_CLONE = 'clone'
const ACT_RESIZE = 'resize'
const ACT_RENAME = 'rename'
const ACT_DELETE = 'delete'
const ACT_REORDER = 'reorder'

const TMP_ATTR_NAME = 'tmp___'
const CHUNK_SIZE = 100
const SLEEP_TIMEOUT = 1000 // 1sec
const API_ENDPOINT = 'http://localhost/v1'   // Can be overriden in .env or with --endpoint

const ERR_NOT_FOUND = 404

let client, db, key, project_id, database_id, collection_id, chunk_size, tmp_attr, opt, verbose, api_endpoint

try {
   config_env() // var env

   // https://www.npmjs.com/package/node-getopt
   opt = getopt.create([
      ['', 'key=ARG', 'API Key'],
      ['', 'endpoint=ARG', 'API endpoint', API_ENDPOINT],
      ['', 'project=ARG', 'project ID'],
      ['', 'database=ARG', 'database ID'],
      ['', 'collection=ARG', 'collection ID'],
      ['', 'chunk-size=ARG', 'nb of documents at once, during document processing', CHUNK_SIZE],
      ['', 'tmp-attr=ARG', 'temporary attribute name', TMP_ATTR_NAME],
      ['v', 'verbose', 'be more verbose'],
      ['h', 'help', 'this aide']
   ])              // create Getopt instance
      .bindHelp(
         "Usage: node aw-dbtweaker.js [OPTIONS] ACTION\n" +
         "[[OPTIONS]]\n\n" +
         "ACTIONS:\n" +
         `  - Clone attribute: ${ACT_CLONE} name clone_name [new_size]\n` +
         `  - List attributes: ${ACT_LIST}\n` +
         `  - Change attribute size: ${ACT_RESIZE} name new_size\n` +
         `  - Rename attribute: ${ACT_RENAME} name new_name\n` +
         `  - Delete attribute: ${ACT_DELETE} name\n` +
         `  - Reorder attributes: ${ACT_REORDER} name...\n` +
         "\nSome examples:\n" +
         `  - Clone attr. "name" to "fullname" 👉 node aw-dbtweaker.js ${ACT_CLONE} name fullname\n` +
         `  - Clone attr. "name" to "fullname" while resizing it to 50 chars 👉 node aw-dbtweaker.js ${ACT_CLONE} name fullname 50\n` +
         `  - Make attr. "name" and "surname" as first attr. 👉 node aw-dbtweaker.js ${ACT_REORDER} name surname\n` +
         `\n🔥 WARNING 🔥 all actions update all documents timestamp!\n`
      )     // bind option 'help' to default action
      .parseSystem() // parse command line

   client = new Client()
   db = new Databases(client)
   api_endpoint = opt.options.endpoint || process.env.APPWRITE_API_ENDPOINT
   key = opt.options.key || process.env.APPWRITE_API_KEY
   project_id = opt.options.project || process.env.APPWRITE_PROJECT_ID
   database_id = opt.options.database || process.env.APPWRITE_DATABASE_ID
   collection_id = opt.options.collection
   chunk_size = Number(opt.options['chunk-size'])
   tmp_attr = opt.options['tmp-attr']
   verbose = opt.options.verbose || opt.options.v || false

   console.log(key)
   if (!api_endpoint) {
      console.error('Missing endpoint')
      opt.showHelp()
      process.exit(1)
   }
   if (!key) {
      console.error('Missing API key')
      opt.showHelp()
      process.exit(1)
   }
   if (!project_id) {
      console.error('Missing project ID')
      opt.showHelp()
      process.exit(1)
   }
   if (!database_id) {
      console.error('Missing database ID')
      opt.showHelp()
      process.exit(1)
   }
   if (!collection_id) {
      console.error('Missing collection ID')
      opt.showHelp()
      process.exit(1)
   }

   client
      .setEndpoint(api_endpoint) // Your API Endpoint
      .setProject(project_id) // Your project ID
      .setKey(key) // Your secret API key
      .setSelfSigned() // Use only on dev mode with a self-signed SSL cert

   doJob()

} catch (err) {
   console.error('Error: ', err)
   process.exit(1)
} finally {
   // console.log('Terminé...')
}

function sleep(duration = SLEEP_TIMEOUT) {
   return new Promise((resolve) => {
      setTimeout(resolve, duration)
   })
}

async function waitAvailable(name) {
   let res
   let loop = true

   // Some actions need to wait for completion asynchronously
   while (loop) {
      res = await db.getAttribute(database_id, collection_id, name)
      if (res.status === 'failed') {
         throw new Error(`Waiting for completion on attr "${name}" - Failed!`)
      }
      loop = (res.status !== 'available')
      if (loop) {
         if (verbose) {
            console.log(`Waiting for attr "${name}" to complete...`)
         }
         await sleep()
      }
   }
}

async function clone_att(orig_name, new_name, resize = null) {
   let res

   if (verbose) {
      console.log(`Cloning attr "${orig_name}" into "${new_name}"`)
   }
   try {
      const attrib = await db.getAttribute(database_id, collection_id, orig_name)
      // console.log(attrib)
      if ((attrib.type === 'string') && (attrib.format === 'email')) {
         res = await db.createEmailAttribute(database_id, collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'enum')) {
         res = await db.createEnumAttribute(database_id, collection_id, new_name, attrib.elements, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'ip')) {
         res = await db.createIpAttribute(database_id, collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'url')) {
         res = await db.createUrlAttribute(database_id, collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'string') {
         res = await db.createStringAttribute(database_id, collection_id, new_name, resize || attrib.size, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'boolean') {
         res = await db.createBooleanAttribute(database_id, collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'double') {
         res = await db.createFloatAttribute(database_id, collection_id, new_name, attrib.required, attrib.min, attrib.max, attrib.default, attrib.array)
      } else if (attrib.type === 'integer') {
         console.log(attrib)
         // -9999... and 9999...: tweak because real values are rejected by `createIntegerAttribute`
         res = await db.createIntegerAttribute(database_id, collection_id, new_name, attrib.required, (attrib.min < -999999999999999) ? null : attrib.min, (attrib.max > 999999999999999) ? null : attrib.max, attrib.default, attrib.array)
      } else if (attrib.type === 'datetime') {
         res = await db.createDatetimeAttribute(database_id, collection_id, new_name, attrib.required, attrib.default, attrib.array)
      }

      // Wait for changes to complete async
      await waitAvailable(new_name)

      res = await db.listDocuments(database_id, collection_id, [
         Query.limit(chunk_size),
         Query.offset(0)
      ])
      // console.log(res)

      let offset = 0
      let total = res.total

      while (offset < total) {
         if (verbose) {
            console.log(`Copying data [${offset}..${Math.min(total, offset + chunk_size)}] from attr "${orig_name}" into "${new_name}"`)
         }
         for (const doc of res.documents) {
            res = await db.updateDocument(database_id, collection_id, doc['$id'], {
               [new_name]: doc[orig_name]
            })
         }
         offset += chunk_size
         if (offset < total) {
            res = await db.listDocuments(database_id, collection_id, [
               Query.limit(chunk_size),
               Query.offset(offset)
            ])
         }
      }
   } catch (err) {
      if (err.code === ERR_NOT_FOUND) {
         err.reason = `Unknown attribute "${orig_name}"`
      }
      throw err
   }
}

async function delete_att(name) {
   let res, loop

   res = await db.deleteAttribute(database_id, collection_id, name)

   loop = true
   // Need to wait for deletion du complete asynchronously
   while (loop) {
      // Delete will throw an Exception when record really disapears
      try {
         res = await db.getAttribute(database_id, collection_id, name)
         console.log('Waiting...')
         await sleep()
      } catch (err) {
         console.log('Delete done...')
         loop = false
      }
   }
}

async function rename_att(name, new_name) {
   /* Renaming involves :
      - clone A to TMP
      - drop A
      - clone TMP to B
      - drop TMP
    */
   await clone_att(name, tmp_attr)
   await waitAvailable(tmp_attr)
   await delete_att(name)
   await clone_att(tmp_attr, new_name)
   await waitAvailable(new_name)
   await delete_att(tmp_attr)
}

async function reorder(arr) {
   /* Reorder attribs:
      - First ones will be those provided as arguments
      - Then keeps the others in same order as they are
    */
   const attribs = (await db.listAttributes(database_id, collection_id)).attributes.map(attr => attr.key)
   const new_order = attribs.sort((attr1, attr2) => {
      if (arr.includes(attr1) && !arr.includes(attr2)) {
         // console.log(`1) ${attr1} vs ${attr2} = -1`)
         return -1
      } else if (!arr.includes(attr1) && arr.includes(attr2)) {
         // console.log(`2) ${attr1} vs ${attr2} = 1`)
         return 1
      } else if (!arr.includes(attr1) && !arr.includes(attr2)) {
         // console.log(`3) ${attr1} vs ${attr2} = ${attr1.localeCompare(attr2)}`)
         return attribs.indexOf(attr1) - attribs.indexOf(attr2)
      } else {
         // console.log(`4) ${attr1} vs ${attr2} = ${arr.indexOf(attr1) - arr.indexOf(attr2)}`)
         return arr.indexOf(attr1) - arr.indexOf(attr2)
      }
   })
   for (const attr of new_order) {
      if (verbose) {
         console.log(`Processing rename on "${attr}"`)
      }
      await rename_att(attr, attr)
   }
}

async function doJob() {
   let res

   if (opt.argv[0] === ACT_LIST) {
      const attribs = await db.listAttributes(database_id, collection_id)
      console.log(attribs)
   } else if (opt.argv[0] === ACT_CLONE) {
      if ((opt.argv.length === 4) && (Number(opt.argv[3]) > 0)) {
         await clone_att(opt.argv[1], opt.argv[2], opt.argv[3])
      } else {
         await clone_att(opt.argv[1], opt.argv[2])
      }
   } else if ((opt.argv[0] === ACT_RESIZE) && (opt.argv.length === 3) && (Number(opt.argv[2]) > 0)) {
      /* Resizing involves :
         - clone A to TMP + resize (all at once)
         - drop A
         - clone TMP to B
         - drop TMP
       */
      await clone_att(opt.argv[1], tmp_attr, opt.argv[2])
      await delete_att(opt.argv[1])
      await clone_att(tmp_attr, opt.argv[1])
      await delete_att(tmp_attr)
   } else if ((opt.argv[0] === ACT_RENAME) && (opt.argv.length === 3)) {
      await rename_att(opt.argv[1], opt.argv[2])
   } else if (opt.argv[0] === ACT_DELETE) {
      await delete_att(opt.argv[1])
   } else if (opt.argv[0] === ACT_REORDER) {
      await reorder(opt.argv)
   } else {
      opt.showHelp()
      process.exit(0)
   }
}
