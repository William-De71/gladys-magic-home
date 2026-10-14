# Magic Home

## Présentation

Cette intégration amène vos appareils Wi-Fi **Magic Home** dans Gladys : ampoules couleur et blanches, contrôleurs de rubans LED, lumières CCT et variables, rubans adressables, guirlandes, prises et interrupteurs — les appareils installés avec les applications Magic Home Pro, Zengge ou Surplife. Vous les allumez et les éteignez, réglez leur couleur, leur blanc et leur luminosité depuis le tableau de bord, lancez leurs effets intégrés depuis vos scènes, et vos scènes savent quand un appareil ne répond plus.

Tout reste sur votre **réseau local** : pas de compte, pas de cloud, rien ne sort de chez vous. Gladys trouve les appareils seule grâce à la recherche de l’application Magic Home (port UDP 48899), puis l’intégration parle directement à chacun (port TCP 5577).

## Prérequis

- Gladys Assistant 5.1.1 ou plus récent.
- Des appareils installés avec l’application Magic Home Pro (ou Zengge, Surplife…) et connectés au **même réseau que Gladys**. Un réseau invité ou une box qui isole les clients Wi-Fi les bloque.
- Sur l’écran d’installation, acceptez la **découverte réseau** (port UDP 48899) : c’est elle qui permet à Gladys de trouver les appareils.

## Configuration

### Recherche

Rien à remplir pour la plupart des logements : appuyez sur **Rechercher et tester les appareils**. Le message liste chaque appareil trouvé avec son adresse, son modèle et s’il répond.

Un appareil que la recherche ne trouve pas (autre sous-réseau, réseau qui filtre la diffusion) : saisissez son adresse dans **Adresses IP**, séparées par des virgules, puis enregistrez.

Donnez à chaque appareil une **adresse IP fixe** dans votre box : l’intégration retrouve un appareil dont l’adresse a changé (grâce à son adresse MAC), mais plus vite avec une adresse fixe.

### Actualisation et langue

- **Actualisation de l’état** : chaque appareil est interrogé toutes les 10 secondes, 30 secondes (par défaut) ou 1 minute. La plupart des appareils signalent aussi leurs changements immédiatement (télécommande, application Magic Home).
- **Recherche automatique** : le réseau est de nouveau parcouru toutes les heures (par défaut), toutes les 15 minutes, ou jamais ; un appareil qui ne répond plus déclenche de toute façon une recherche.
- **Langue des textes des appareils** : les noms des fonctionnalités dans l’onglet Découverte et les messages d’erreur des scènes sont écrits dans cette langue, car Gladys n’envoie pas la vôtre avec eux.

## Utilisation

### Appareils

Ouvrez l’onglet **Découverte** de l’intégration : chaque appareil trouvé est listé avec les fonctionnalités que permettent son modèle et son câblage. Ajoutez ceux que vous voulez, et renommez-les à votre goût.

- Ampoules couleur et blanches, contrôleurs RGB&CCT : **Marche/arrêt**, **Luminosité**, **Couleur**, **Température de couleur**.
- Contrôleurs et ampoules RGB, RGBW et RGB/W, rubans adressables, guirlandes : **Marche/arrêt**, **Luminosité**, **Couleur** (une couleur blanche allume les LED blanches d’un appareil RGB+W).
- Ampoules et contrôleurs CCT : **Marche/arrêt**, **Luminosité**, **Température de couleur**.
- Contrôleurs monochromes, ampoules variables : **Marche/arrêt**, **Luminosité**.
- Prises et interrupteurs : **Marche/arrêt**.

Une couleur et un blanc sont des alternatives : choisir une couleur allume les LED de couleur, choisir une température allume les LED blanches, comme le fait l’application Magic Home. Chaque appareil affiche un badge **local**, ou **injoignable** quand il ne répond pas.

### Widgets

![Les widgets « Lumières Magic Home » et « Effets Magic Home » : cinq appareils avec leur état et leur luminosité, la lampe du salon qui joue la boucle de couleurs avec ses boutons d’effet (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-magic-home/main/docs/assets/widgets.fr.png)

- **Lumières Magic Home** : combien d’appareils sont allumés, combien ne répondent pas, chaque appareil avec son état, sa luminosité et ce qu’il joue, un bouton **Tout éteindre** (avec confirmation) et **Actualiser**. Réglage : tous les appareils ou seulement ceux allumés.
- **Effets Magic Home** : une lumière choisie dans les réglages, son état, son mode et sa luminosité, un bouton marche/arrêt et trois boutons d’effet que vous choisissez dans les réglages (avec leur vitesse). Pendant un effet, le troisième bouton devient **Fixe**.

### Déclencheurs de scène

- **Un appareil Magic Home ne répond plus** : débranché, coupé à l’interrupteur ou hors Wi-Fi depuis plus de 30 secondes.
- **Un appareil Magic Home répond à nouveau** : après une absence de réponse.

Les deux peuvent être limités à un appareil et donnent `device_name` et `ip` à la scène.

### Actions de scène

- **Lancer un effet Magic Home** : l’un des 23 effets intégrés (boucle de couleurs, sauts, pulsations, stroboscopes…), sa vitesse, et sa luminosité sur les firmwares récents.
- **Jouer des couleurs Magic Home** : jusqu’à 16 couleurs au choix (`#FF0000, #0000FF`), en fondu, en saut ou en stroboscope.
- **Faire clignoter une lumière Magic Home** : fait clignoter une couleur de 1 à 60 secondes, puis la lumière revient comme avant (couleur, blanc, effet, ou éteinte).
- **Arrêter un effet Magic Home** : retour à la dernière couleur ou au dernier blanc fixe.

### Exemples de scènes

- Quand quelqu’un sonne à la porte → **Faire clignoter une lumière Magic Home** en rouge pendant 5 secondes sur la lampe du salon.
- Quand la lumière du jardin ne répond plus → vous envoyer un message : elle a été coupée à l’interrupteur.
- Chaque soir au coucher du soleil → ruban de la cuisine à 40 %, puis **Jouer des couleurs Magic Home** `#FF6A00, #FF0040` en fondu lent sur le ruban du salon.

## Dépannage

- **Aucun appareil trouvé** : vérifiez que l’appareil répond dans l’application Magic Home **en Wi-Fi** (pas par le cloud, hors de chez vous), qu’il est sur le même réseau que Gladys et que la box n’isole pas les clients Wi-Fi. Sinon, saisissez son adresse IP dans la configuration.
- **« Gladys a refusé la découverte réseau »** : réinstallez l’intégration et acceptez son accès au réseau sur l’écran d’installation.
- **Un appareil est « Injoignable »** : il est débranché, coupé à l’interrupteur ou hors Wi-Fi. Si son adresse a changé, la recherche suivante le retrouve ; appuyez sur **Rechercher et tester les appareils** pour chercher tout de suite.
- **Un effet ne démarre pas** : les prises, les appareils à blanc seul et les rubans adressables n’ont pas d’effets intégrés dans cette intégration ; quelques effets n’existent que sur les firmwares récents.
- **Une fonctionnalité manque ou est fausse** : les fonctionnalités suivent le modèle et le câblage annoncés par l’appareil (son paramètre `MAGICHOME_MODEL`). Ouvrez une issue sur GitHub avec ce paramètre, les versions de Gladys et de l’intégration, et les logs (onglet Logs de l’intégration).
