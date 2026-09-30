# Alpaca: oplevercontrole 2026-09-29

- Lokale Docker-build geslaagd en container healthy. Bestaande bronnen behouden; Alpaca is als vierde bron toegevoegd, uitgeschakeld en met feed IEX.
- 33 tests geslaagd, inclusief Alpaca-contractfixtures voor headers, feed/symbool/valuta, UTC-historie, foutredactie, quote- versus transactietijd, dagbars, sleutelparen, encryptie, lokale migratie/heropenen, failover en verwerpen van oude aanvragen tijdens herstart.
- WebSocket-protocol met een socketfixture gecontroleerd: authenticatie vóór subscriptions, dynamische symbolen, correctie/annulering, opnieuw verbinden bij ontbrekende rechten en stoppen zonder achterblijvende timers.
- Beheerpagina in de ingebouwde browser getest: drie feedkeuzes en hun uitleg, twee passwordvelden, blokkering van inschakelen zonder sleutels, zichtbare fout binnen het formulier en opslaan van de uitgeschakelde IEX-configuratie.
- Desktop en mobiele breedte 390 px visueel gecontroleerd; geen horizontale overloop. Browserconsole zonder relevante fouten. Formatteringscontrole geslaagd.
- Echte Alpaca-authenticatie en ontvangst zijn nog niet geverifieerd: er zijn geen Alpaca-sleutels ingevuld. Bestaande crypto-feeds bleven echte data leveren. Geen sleutels uit andere projecten opgezocht of hergebruikt.

Activatie: Databronnen → Alpaca bewerken → API Key ID en Secret Key lokaal invullen → gewenste feed kiezen → inschakelen → Opslaan → Test. De REST-test is geen bewijs dat alle symbolen, realtimefeeds of abonnementen beschikbaar zijn; controleer daarna bronstatus en koerstijden in de terminal. Zie README voor feeddekking en limieten.

## Formulierherstel (29 september 2026)

- Sleutelvelden verplaatst naar een gezamenlijke sectie bovenaan; op desktop naast elkaar en op mobiel onder elkaar.
- Alleen de formulierinhoud scrollt; titel en acties blijven bereikbaar. Bestaande opgeslagen sleutels blijven ongewijzigd.
- Browsercontrole op 1280×720 en 390×844: beide wachtwoordvelden zichtbaar, ingeschakeld en niet overlapt; Tab vanaf API Key ID focust Secret Key.
- Op 390×500 scrollt de inhoud en blijft Opslaan binnen het scherm.
- Geen sleutels ingevoerd, gelezen of opgeslagen tijdens deze controle. Geen browserwaarschuwingen of fouten.
- Productiebouw en alle 33 tests geslaagd; lokale Docker-container opnieuw opgebouwd en gestart.
