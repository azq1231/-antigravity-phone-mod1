
import { findAllInstances } from '../core/cdp_manager.js';

async function listAll() {
    const instances = await findAllInstances();
    console.log(JSON.stringify(instances, null, 2));
    process.exit(0);
}

listAll();
