import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { WorkTimer } from "./actions/work-timer";
import { CheckIn } from "./actions/check-in";
import { CheckOut } from "./actions/check-out";
import { Pause } from "./actions/pause";
import { sesameAPI } from "./services/sesame-api";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

streamDeck.logger.info('=== PLUGIN STARTING ===');
streamDeck.logger.info('About to register actions...');

// Register actions
streamDeck.logger.info('Registering WorkTimer...');
streamDeck.actions.registerAction(new WorkTimer());
streamDeck.logger.info('Registering CheckIn...');
streamDeck.actions.registerAction(new CheckIn());
streamDeck.logger.info('Registering CheckOut...');
streamDeck.actions.registerAction(new CheckOut());
streamDeck.logger.info('Registering Pause...');
streamDeck.actions.registerAction(new Pause());
streamDeck.logger.info('All actions registered!');

// Handle global settings updates
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
    streamDeck.logger.info('Global settings received:', ev.settings);
    // The SesameAPI will now automatically load credentials from global settings when needed
});

// Finally, connect to the Stream Deck.
streamDeck.logger.info('Connecting to StreamDeck...');
streamDeck.connect();

// Request global settings on startup to trigger onDidReceiveGlobalSettings
streamDeck.logger.info('Requesting global settings...');
streamDeck.settings.getGlobalSettings();

// Initialize polling for status updates if user is authenticated
streamDeck.logger.info('Initializing status polling...');
sesameAPI.initializePolling()
    .then(() => {
        streamDeck.logger.info('Status polling initialization completed');
    })
    .catch((error) => {
        streamDeck.logger.error('Status polling initialization error:', error);
    });

streamDeck.logger.info('=== PLUGIN INITIALIZATION COMPLETE ===');
