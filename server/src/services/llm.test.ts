import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldForceVmAgent } from './llm';

test('shouldForceVmAgent true for explicit VM request with resource group', () => {
  const message = 'create an Ubuntu VM named WEB1 in the webservers resource group';
  const clarification =
    'What is your goal for this Azure session (for example, create a VM, set up a VNet, manage storage, etc.) and which resource group and region should we use?';

  assert.equal(shouldForceVmAgent(message, clarification), true);
});

test('shouldForceVmAgent false when request is not VM creation', () => {
  const message = 'list all resource groups';
  assert.equal(shouldForceVmAgent(message, 'What is your goal?'), false);
});
