# WJP yield

Nieuw, zelfstandig project. Gebruik geen code of ontwerpen uit eerdere tradingprojecten.
Opslag: uitsluitend lokaal, expliciet bevestigd 2026-09-29. Geen iCloud.
Doel v0.1: betrouwbare read-only marktdata, grafieken, watchlists, providerbeheer.
Geen orders, broker-trading, verzonnen live data of automatisch ingeschakelde betaalde feeds.
Controleer wijzigingen met npm run check en de lokale Docker/browser-flow.
Provideradapters normaliseren data naar het domeincontract. Behoud bron, venue,
quotevaluta, provider-tijd, ontvangsttijd en transport. Voeg een adapter toe voor
nieuwe feedprotocollen; wijzig daarvoor de terminal-UI niet.
Bewaar sleutels alleen server-side versleuteld in de lokale Docker-volume.
