/** Loads the lander-pack sprites for the orbital sortie. Images are bundled as data URIs (esbuild) or assets (vite). */
import ships from '../assets/lander/ships.png';
import guns from '../assets/lander/guns.png';
import turrets from '../assets/lander/turrets.png';
import missiles from '../assets/lander/missiles.png';
import explosion from '../assets/lander/explosion.png';
import fx1 from '../assets/lander/fx1.png';
import fx2 from '../assets/lander/fx2.png';
import fx3 from '../assets/lander/fx3.png';
import fx4 from '../assets/lander/fx4.png';
import fx5 from '../assets/lander/fx5.png';
import thruster1 from '../assets/lander/thruster1.png';
import thruster3 from '../assets/lander/thruster3.png';
import thruster4 from '../assets/lander/thruster4.png';
import asteroids from '../assets/lander/asteroids.png';
import asteroidsFg from '../assets/lander/asteroids_fg.png';
import stars from '../assets/lander/stars.png';
import debris from '../assets/lander/debris.png';
import hullBar from '../assets/lander/hull_bar.png';
import fuelBar from '../assets/lander/fuel_bar.png';
import radar from '../assets/lander/radar.png';
import gauges from '../assets/lander/gauges.png';
import crewIcon from '../assets/lander/crew_icon.png';
import crewCounter from '../assets/lander/crew_counter.png';
import missileIcon from '../assets/lander/missile_icon.png';
import missileCounter from '../assets/lander/missile_counter.png';

const SOURCES = {
  ships, guns, turrets, missiles, explosion, fx1, fx2, fx3, fx4, fx5, thruster1, thruster3, thruster4, asteroids, asteroidsFg,
  stars, debris, hullBar, fuelBar, radar, gauges, crewIcon, crewCounter, missileIcon, missileCounter,
};
export type AssetName = keyof typeof SOURCES;
export type SpaceAssets = Record<AssetName, HTMLImageElement>;

let promise: Promise<SpaceAssets> | null = null;

export function loadSpaceAssets(): Promise<SpaceAssets> {
  if (!promise) {
    promise = Promise.all(
      (Object.keys(SOURCES) as AssetName[]).map(
        (k) => new Promise<[AssetName, HTMLImageElement]>((res, rej) => {
          const img = new Image();
          img.onload = () => res([k, img]);
          img.onerror = () => rej(new Error(`Could not load sprite ${k}`));
          img.src = SOURCES[k];
        }),
      ),
    ).then((pairs) => Object.fromEntries(pairs) as SpaceAssets);
    promise.catch(() => { promise = null; });
  }
  return promise;
}
