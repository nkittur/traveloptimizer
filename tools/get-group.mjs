#!/usr/bin/env node
// get-group.mjs — Print a group row as JSON. Usage: node tools/get-group.mjs <group-id>
import { selectOne } from './_db.mjs';

const groupId = process.argv[2];
if (!groupId) {
  console.error('Usage: get-group.mjs <group-id>');
  process.exit(1);
}

const group = await selectOne('groups', { id: groupId });
if (!group) {
  console.error(`No group with id=${groupId}`);
  process.exit(2);
}
console.log(JSON.stringify(group, null, 2));
