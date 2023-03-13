import { Client, Databases, Query, ID } from 'node-appwrite'
import { config as config_env } from 'dotenv'
import getopt from 'node-getopt'

const ACT_LIST = 'list'
const ACT_CLONE = 'clone'
const ACT_CLONE_COLLECTION = 'clone_collection'
const ACT_DELETE_COLLECTION = 'delete_collection'
const ACT_RESIZE = 'resize'
const ACT_RENAME = 'rename'
const ACT_DELETE = 'delete'
const ACT_REORDER = 'reorder'

const TMP_ATTR_NAME = 'tmp___'
const CHUNK_SIZE = 100
const SLEEP_TIMEOUT = 1000 // 1sec
const API_ENDPOINT = 'http://localhost/v1'   // Can be overriden in .env or with --endpoint

const ERR_NOT_FOUND = 404

let client, db, key, project_id, database_id, collection_id, chunk_size, tmp_attr, opt, verbose, api_endpoint, with_data

try {
   config_env() // var env

   // https://www.npmjs.com/package/node-getopt
   opt = getopt.create([
      ['', 'key=ARG', 'API Key'],
      ['', 'endpoint=ARG', 'API endpoint', API_ENDPOINT],
      ['', 'project=ARG', 'project ID'],
      ['', 'database=ARG', 'database ID'],
      ['', 'collection=ARG', 'collection ID'],
      ['', 'with-data', 'clone documents when cloning collection'],
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
         `  - Clone collection: ${ACT_CLONE_COLLECTION} name clone_name\n` +
         `  - Delete collection: ${ACT_DELETE_COLLECTION} name\n` +
         "\nSome examples:\n" +
         `  - Clone attr. "name" to "fullname" 👉 node aw-dbtweaker.js ${ACT_CLONE} name fullname\n` +
         `  - Clone attr. "name" to "fullname" while resizing it to 50 chars 👉 node aw-dbtweaker.js ${ACT_CLONE} name fullname 50\n` +
         `  - Make attr. "name" and "surname" as first attr. 👉 node aw-dbtweaker.js ${ACT_REORDER} name surname\n` +
         `\n🔥 WARNING 🔥 some actions update all documents timestamp!\n`
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
   with_data = opt.options['with-data']
   verbose = opt.options.verbose || opt.options.v || false

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
   // } finally {
}

function sleep(duration = SLEEP_TIMEOUT) {
   return new Promise((resolve) => {
      setTimeout(resolve, duration)
   })
}

async function waitAvailable(name, type = 'attribute') {
   return await _waitAvailable(database_id, collection_id, name, type = 'attribute')
}

async function _waitAvailable(_database_id, _collection_id, name, type = 'attribute') {
   let res
   let loop = true

   // Some actions need to wait for completion asynchronously
   while (loop) {
      if (verbose) {
         console.log(`Waiting for ${type} "${name}" to complete...`)
      }
      if (type === 'attribute') {
         res = await db.getAttribute(_database_id, _collection_id, name)
      } else if (type === 'index') {
         res = await db.getIndex(_database_id, _collection_id, name)
      } else {
         throw new Error(`waitAvailable: unknown type "${type}"`)
      }
      if (res.status === 'failed') {
         throw new Error(`Waiting for completion on ${type} "${name}" - Failed!`)
      }
      loop = (res.status !== 'available')
      if (loop) {
         await sleep()
      }
   }
}

async function waitDelete(name, type = 'attribute') {
   let loop

   loop = true
   // Need to wait for deletion du complete asynchronously
   while (loop) {
      // Delete will throw an Exception when record really disapears
      try {
         console.log(`Waiting for delete ${type} ${name} ...`)
         if (type === 'attribute') {
            await db.getAttribute(database_id, collection_id, name)
         } else if (type === 'index') {
            await db.getIndex(database_id, collection_id, name)
         } else {
            throw new Error(`waitDelete: unknown type "${type}"`)
         }
         await sleep()
      } catch (err) {
         console.log(`Delete ${type} ${name} done...`)
         loop = false
      }
   }
}

async function getIndexes(attr_name) {
   const idx = await db.listIndexes(database_id, collection_id)
   return idx.indexes.filter((an_idx) => an_idx.attributes.includes(attr_name))
}

async function rebuildIndexes(indexes, old_name = null, new_name = null) {
   if (verbose && (indexes.length <= 0)) {
      console.log('No index to recreate')
   }
   for (const index of indexes) {
      if (verbose) {
         console.log(`Recreating index "${index.key}"`)
      }
      const attributes = index.attributes.map((attr) => {
         if (!old_name) {
            return attr
         } else {
            return (attr === old_name) ? new_name : attr
         }
      })
      try {
         await db.deleteIndex(database_id, collection_id, index.key)
         await waitDelete(index.key, 'index')
      } catch (err) {
         // 404 is OK, means index has been deleted during the action
         if (err.code !== ERR_NOT_FOUND) {
            throw err
         }
      }

      await db.createIndex(database_id, collection_id, index.key, index.type, attributes, index.orders)
      await waitAvailable(index.key, 'index')
   }
}

async function clone_att(orig_name, new_name, resize = null) {
   return await _clone_att(database_id, collection_id, orig_name, collection_id, new_name, resize)
}

async function _clone_att(_database_id, orig_collection_id, orig_name, dest_collection_id, new_name, resize = null) {
   let res

   if (verbose) {
      console.log(`Cloning attr "${orig_name}" into "${new_name}"`)
   }
   try {
      const attrib = await db.getAttribute(_database_id, orig_collection_id, orig_name)
      if ((attrib.type === 'string') && (attrib.format === 'email')) {
         res = await db.createEmailAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'enum')) {
         res = await db.createEnumAttribute(_database_id, dest_collection_id, new_name, attrib.elements, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'ip')) {
         res = await db.createIpAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if ((attrib.type === 'string') && (attrib.format === 'url')) {
         res = await db.createUrlAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'string') {
         res = await db.createStringAttribute(_database_id, dest_collection_id, new_name, resize || attrib.size, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'boolean') {
         res = await db.createBooleanAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.default, attrib.array)
      } else if (attrib.type === 'double') {
         res = await db.createFloatAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.min, attrib.max, attrib.default, attrib.array)
      } else if (attrib.type === 'integer') {
         // -9999... and 9999...: tweak because real values are rejected by `createIntegerAttribute`
         res = await db.createIntegerAttribute(_database_id, dest_collection_id, new_name, attrib.required, (attrib.min < -999999999999999) ? null : attrib.min, (attrib.max > 999999999999999) ? null : attrib.max, attrib.default, attrib.array)
      } else if (attrib.type === 'datetime') {
         res = await db.createDatetimeAttribute(_database_id, dest_collection_id, new_name, attrib.required, attrib.default, attrib.array)
      }

      // Wait for changes to complete async
      await _waitAvailable(_database_id, dest_collection_id, new_name)

      // Duplicate documents only when cloning attribs in the same collection
      if (orig_collection_id === dest_collection_id) {
         res = await db.listDocuments(_database_id, collection_id, [
            Query.limit(chunk_size),
            Query.offset(0)
         ])

         let offset = 0
         let total = res.total

         while (offset < total) {
            if (verbose) {
               console.log(`Copying data [${offset}..${Math.min(total, offset + chunk_size)}] from attr "${orig_name}" into "${new_name}"`)
            }
            for (const doc of res.documents) {
               res = await db.updateDocument(_database_id, collection_id, doc['$id'], {
                  [new_name]: doc[orig_name]
               })
            }
            offset += chunk_size
            if (offset < total) {
               res = await db.listDocuments(_database_id, collection_id, [
                  Query.limit(chunk_size),
                  Query.offset(offset)
               ])
            }
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
   await waitDelete(name)
}

async function rename_att(name, new_name) {
   /* Renaming involves :
      - clone A to TMP
      - drop A
      - clone TMP to B
      - drop TMP
    */
   const indexes = await getIndexes(name)
   await clone_att(name, tmp_attr)
   await waitAvailable(tmp_attr)
   await delete_att(name)
   await clone_att(tmp_attr, new_name)
   await waitAvailable(new_name)
   await delete_att(tmp_attr)
   await rebuildIndexes(indexes, name, new_name)
}

async function reorder_att(arr) {
   /* Reorder attribs:
      - First ones will be those provided as arguments
      - Then keeps the others in same order as they are
    */
   const attribs = (await db.listAttributes(database_id, collection_id)).attributes.map(attr => attr.key)
   const new_order = attribs.sort((attr1, attr2) => {
      if (arr.includes(attr1) && !arr.includes(attr2)) {
         return -1
      } else if (!arr.includes(attr1) && arr.includes(attr2)) {
         return 1
      } else if (!arr.includes(attr1) && !arr.includes(attr2)) {
         return attribs.indexOf(attr1) - attribs.indexOf(attr2)
      } else {
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

async function clone_collection(new_name) {
   let res

   res = await db.getCollection(database_id, collection_id)
   await db.createCollection(database_id, new_name, new_name, [], res.documentSecurity)
   const attribs = await db.listAttributes(database_id, collection_id)
   for (const an_attrib of attribs.attributes) {
      await _clone_att(database_id, collection_id, an_attrib.key, new_name, an_attrib.key)
      // await _waitAvailable(database_id, new_name, an_attrib.key)
   }

   const all_indexes = await db.listIndexes(database_id, collection_id)
   for (const index of all_indexes.indexes) {
      await db.createIndex(database_id, new_name, index.key, index.type, index.attributes, index.orders)
   }

   // await sleep(2000)

   // Clone data
   if (with_data) {
      res = await db.listDocuments(database_id, collection_id, [
         Query.limit(chunk_size),
         Query.offset(0)
      ])

      let offset = 0
      let total = res.total

      while (offset < total) {
         if (verbose) {
            console.log(`Copying data [${offset}..${Math.min(total, offset + chunk_size)}] from collection "${collection_id}" into "${new_name}"`)
         }
         for (let doc of res.documents) {
            delete doc['$id']
            delete doc['$createdAt']
            delete doc['$updatedAt']
            delete doc['$permissions']
            delete doc['$collectionId']
            delete doc['$databaseId']
            res = await db.createDocument(database_id, new_name, ID.unique(), doc)
         }
         offset += chunk_size
         if (offset < total) {
            res = await db.listDocuments(database_id, collection_id, [
               Query.limit(chunk_size),
               Query.offset(offset)
            ])
         }
      }
   }
}

async function doJob() {
   let res

   if (opt.argv[0] === ACT_LIST) {
      const attribs = await db.listAttributes(database_id, collection_id)
      console.log(attribs)
   } else if ((opt.argv[0] === ACT_CLONE) && (opt.argv.length >= 3)) {
      const indexes = await getIndexes(opt.argv[1])
      if ((opt.argv.length > 3) && (Number(opt.argv[3]) > 0)) {
         await clone_att(opt.argv[1], opt.argv[2], opt.argv[3])
      } else {
         await clone_att(opt.argv[1], opt.argv[2])
      }
      if (indexes.length > 0) {
         console.log("CLONING do not clone indexes.\nHere are the original indexes (add them manually if needed):")
         for (const index of indexes) {
            console.log(`Key: ${index.key}, Type: ${index.type}, Attributes: ${index.attributes}, Orders: ${index.orders}`)
         }
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
      await reorder_att(opt.argv)
   } else if ((opt.argv[0] === ACT_CLONE_COLLECTION) && (opt.argv.length == 2)) {
      await clone_collection(opt.argv[1])
   } else if (opt.argv[0] === ACT_DELETE_COLLECTION) {
      await db.deleteCollection(database_id, collection_id)
   } else {
      opt.showHelp()
      process.exit(0)
   }
}
