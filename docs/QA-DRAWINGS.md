# Tekentools: oplevercontrole 2026-09-29

Getest op de lokale Docker-terminal op http://localhost:4310/.

- Productiebuild en alle 21 tests geslaagd. Nieuwe tests dekken tijdankers bij candle-gaten en tijdsperiodewissels, Fibonacci-richting, invoervalidatie, opslag per instrument, bewerken, verwijderen, limiet en databaseherstart.
- In de ingebouwde browser daadwerkelijk horizontaal niveau, trendlijn, rechthoek en Fibonacci getekend; kleur gewijzigd en een ankerpunt versleept.
- Verwijderen en ongedaan maken gecontroleerd, plus verbergen/tonen en annuleren met Esc. Een klik in het RSI-vak start geen tekening.
- Tekeningen teruggevonden na herladen en herbouw/herstart van Docker; behouden bij candlestick/lijngrafiek en 1u/15m. Ethereum bleef gescheiden van Bitcoin.
- Bij pan en zoom veranderden de getekende schermcoördinaten met de grafiek mee.
- Mobiele weergave op 390 × 844 gecontroleerd: geen horizontale pagina-overloop; een rechthoek via de mobiele tekenbalk geplaatst en verwijderd. Desktop op standaard 1280-breedte gecontroleerd.
- Browserconsole zonder fouten of waarschuwingen na de definitieve wijzigingen. Docker rapporteerde healthy. Prettier-controle geslaagd.
- Tijdens de controle twee fouten opgelost: het canvas onderschepte de tekenlaag door overlappende z-indexen; lege DELETE-verzoeken kregen onterecht een JSON Content-Type. Het canvas heeft nu een eigen stapelcontext en de API-client stuurt Content-Type alleen bij een body.
- Alle tijdelijke testtekeningen verwijderd en de lege selectie na herladen geverifieerd. De schermafbeeldingen tonen uitsluitend voorbeelden uit deze controle.

Bekende grenzen: maximaal 100 tekeningen per instrument, lineaire prijsschaal en een herstelgeschiedenis van 30 bewerkingen die bij instrumentwissel/herladen vervalt. Buiten het geladen candle-bereik wordt de tijdpositie geëxtrapoleerd. Gelijktijdig bewerken van dezelfde tekening gebruikt de laatst opgeslagen versie.
