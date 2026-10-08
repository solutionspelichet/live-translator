import Power from '../../modules/dualcast-power';
import { setSleep } from '../utils/http';
import { createTimers } from '../utils/timers';

/**
 * setTimeout / setInterval that keep running with the screen off (native timers; plain JS timers if the native module is
 * missing). Use these, not the global ones, for anything the translation depends on.
 */
const BackgroundTimers = createTimers(Power.nativeTimers);

// Retries of the network calls wait with the same timers.
setSleep((ms) => BackgroundTimers.sleep(ms));

export default BackgroundTimers;
