// Posing the game's HSD models in three.js, as hsd-model.js reads them.
import * as THREE from '../node_modules/three/build/three.module.js';

// A joint's local matrix (HSD_MtxSRT): scale, then rotation about X, Y and Z, then
// translation. `parentScale` undoes a parent's uneven scale, as the game does.
export function jointMatrix(scale, rotation, translation, parentScale, out) {
  const sinX = Math.sin(rotation[0]), cosX = Math.cos(rotation[0]), sinY = Math.sin(rotation[1]), cosY = Math.cos(rotation[1]);
  const sinZ = Math.sin(rotation[2]), cosZ = Math.cos(rotation[2]);
  let sx0 = scale[0], sy0 = scale[1], sz0 = scale[2], sx1 = sx0, sy1 = sy0, sz1 = sz0, sx2 = sx0, sy2 = sy0, sz2 = sz0;
  if (parentScale) {
    const [px, py, pz] = parentScale, ix = 1 / px, iy = 1 / py, iz = 1 / pz;
    sy2 *= py * ix;
    sz2 *= pz * ix;
    sx1 *= px * iy;
    sz1 *= pz * iy;
    sx0 *= px * iz;
    sy0 *= py * iz;
  }
  const e = out.elements;
  e[0] = cosZ * sx2 * cosY;
  e[1] = sinZ * sx1 * cosY;
  e[2] = -sx0 * sinY;
  e[3] = 0;
  e[4] = sy2 * (cosZ * sinX * sinY - cosX * sinZ);
  e[5] = sy1 * (sinZ * sinX * sinY + cosX * cosZ);
  e[6] = cosY * sy0 * sinX;
  e[7] = 0;
  e[8] = sz2 * (cosZ * cosX * sinY + sinX * sinZ);
  e[9] = sz1 * (sinZ * cosX * sinY - sinX * cosZ);
  e[10] = cosY * sz0 * cosX;
  e[11] = 0;
  e[12] = translation[0];
  e[13] = translation[1];
  e[14] = translation[2];
  e[15] = 1;
  return out;
}

// Where a material's texture sits (the game's MakeTextureMtx, for a layer that doesn't
// turn), from its translation and scale.
export function placeTexture(texture, material, translateU, translateV, scaleU, scaleV) {
  const s = Math.abs(scaleU) < Number.EPSILON ? 0 : material.repeat[0] / scaleU, t = Math.abs(scaleV) < Number.EPSILON ? 0 : material.repeat[1] / scaleV;
  texture.repeat.set(s, t);
  texture.offset.set(-translateU * s, -(translateV + (material.mirrorT && t ? 1 / t : 0)) * t);
}

// Joints ordered parents first: hsd-model.js lists a parent before its children.
export function createRig(rig, makeMesh) {
  const count = rig.joints.length;
  const world = rig.joints.map(() => new THREE.Matrix4());
  const inverseBind = rig.inverseBind.map(m => (m ? new THREE.Matrix4().fromArray(m) : new THREE.Matrix4()));
  const drawMatrices = rig.draw.map(() => new THREE.Matrix4());
  const meshes = rig.shapes.map(makeMesh);
  const local = new THREE.Matrix4(), product = new THREE.Matrix4(), right = new THREE.Matrix4(), skeleton = new THREE.Matrix4();
  const scales = rig.joints.map(() => [1, 1, 1]), hasScale = new Uint8Array(count);
  const rest = new Float32Array(count * 9);
  rig.joints.forEach((joint, j) => rest.set([...joint.scale, ...joint.rotation, ...joint.translation], j * 9));

  // The matrix that moves a mesh from its own joint to its skeleton's frame.
  function nodeMatrix({ owner, skeleton: x, kind }) {
    if (kind === 'bind') return right.copy(inverseBind[x]).invert();
    if (kind === 'root') skeleton.copy(world[x]);
    else skeleton.multiplyMatrices(world[x], inverseBind[x]);
    return right.copy(skeleton).invert().multiply(world[owner]);
  }

  return {
    meshes, world,
    // `values` holds nine values for each joint: its scale, rotation and translation.
    pose(values = rest) {
      for (let j = 0; j < count; j++) {
        const joint = rig.joints[j], parent = joint.parent, o = j * 9, scale = scales[j];
        const parentScale = parent >= 0 && hasScale[parent] ? scales[parent] : null;
        // A joint's scale passes down to its children (JObjMakeMatrix).
        if (joint.classicalScale) {
          hasScale[j] = parentScale ? 1 : 0;
          if (parentScale) { scale[0] = parentScale[0]; scale[1] = parentScale[1]; scale[2] = parentScale[2]; }
        } else {
          hasScale[j] = 1;
          scale[0] = values[o] * (parentScale ? parentScale[0] : 1);
          scale[1] = values[o + 1] * (parentScale ? parentScale[1] : 1);
          scale[2] = values[o + 2] * (parentScale ? parentScale[2] : 1);
        }
        jointMatrix(values.subarray(o, o + 3), values.subarray(o + 3, o + 6), values.subarray(o + 6, o + 9), parentScale, local);
        if (parent >= 0) world[j].multiplyMatrices(world[parent], local);
        else world[j].copy(local);
      }
      rig.draw.forEach(({ parts, node }, d) => {
        const out = drawMatrices[d];
        if (parts.length === 1 && parts[0].weight === 1) {
          if (parts[0].inverse) out.multiplyMatrices(world[parts[0].joint], inverseBind[parts[0].joint]);
          else out.copy(world[parts[0].joint]);
        } else {
          out.elements.fill(0);
          for (const { joint, weight, inverse } of parts) {
            if (inverse) product.multiplyMatrices(world[joint], inverseBind[joint]);
            else product.copy(world[joint]);
            for (let e = 0; e < 16; e++) out.elements[e] += product.elements[e] * weight;
          }
        }
        if (node) out.multiply(nodeMatrix(node));
      });
      for (const { shape, geometry } of meshes) {
        const position = geometry.attributes.position.array, normal = geometry.attributes.normal.array;
        for (let i = 0, n = shape.drawIndex.length; i < n; i++) {
          const m = drawMatrices[shape.drawIndex[i]].elements, o = i * 3;
          const x = shape.position[o], y = shape.position[o + 1], z = shape.position[o + 2];
          position[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
          position[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          position[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          const nx = shape.normal[o], ny = shape.normal[o + 1], nz = shape.normal[o + 2];
          const tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz;
          const length = Math.hypot(tx, ty, tz) || 1;
          normal[o] = tx / length;
          normal[o + 1] = ty / length;
          normal[o + 2] = tz / length;
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.normal.needsUpdate = true;
      }
    },
  };
}
