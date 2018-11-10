// @flow
/*
  Copyright(c) 2018 Uber Technologies, Inc.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

          http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import * as d3 from 'd3';
import * as React from 'react';
import * as lineIntersect from 'line-intersect';
import { intersect, shape } from 'svg-intersections';
import { Point2D, Matrix2D } from 'kld-affine';
import { Intersection } from 'kld-intersections';
import GraphUtils from './graph-util';
import { type INode } from './node';

export type IEdge = {
  source: string;
  target: string;
  type?: string;
  handleText?: string;
  [key: string]: any;
};

export type ITargetPosition = {
  x: number,
  y: number
};

type IEdgeProps = {
  data: IEdge;
  edgeTypes: any; // TODO: create an edgeTypes interface
  edgeHandleSize?: number;
  nodeSize?: number;
  sourceNode: INode | null;
  targetNode: INode | ITargetPosition;
  isSelected: boolean;
  nodeKey: string;
};

class Edge extends React.Component<IEdgeProps> {
  static defaultProps = {
    edgeHandleSize: 50,
    isSelected: false
  };

  static getTheta(pt1: any, pt2: any) {
    const xComp = (pt2.x || 0) - (pt1.x || 0);
    const yComp = (pt2.y || 0) - (pt1.y || 0);
    const theta = Math.atan2(yComp, xComp);
    return theta;
  }

  static getDegrees (radians: number) {
    return radians * (180 / Math.PI);
  }

  static getRadians(degrees: number) {
    return (degrees / 180) * Math.PI;
  }

  static getDistance(pt1: any, pt2: any) {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  }

  static lineFunction(srcTrgDataArray: any) {
    // Provides API for curved lines using .curve() Example:
    // https://bl.ocks.org/d3indepth/64be9fc39a92ef074034e9a8fb29dcce
    return d3
      .line()
      .x((d: any) => {
        return d.x;
      })
      .y((d: any) => {
        return d.y;
      })(srcTrgDataArray);
  }

  static getArrowSize() {
    const defEndArrowElement: any = document.querySelector(`defs>marker>.arrow`);
    return defEndArrowElement.getBoundingClientRect();
  }

  static getEdgePathElement(edge: IEdge) {
    return document.querySelector(`#edge-${edge.source}-${edge.target}-container>.edge-container>.edge>.edge-path`);
  }

  static parsePathToXY(edgePathElement: Element | null) {
    const response = {
      source: {
        x: 0,
        y: 0
      },
      target: {
        x: 0,
        y: 0
      }
    };
    if (edgePathElement) {
      let d = edgePathElement.getAttribute('d');
      d = d && d.replace(/^M/, '');
      d = d && d.replace(/L/, ',');
      let dArr = (d && d.split(',')) || [];
      dArr = dArr.map(dimension => {
        return parseFloat(dimension);
      });
      if (dArr.length === 4) {
        response.source.x = dArr[0];
        response.source.y = dArr[1];
        response.target.x = dArr[2];
        response.target.y = dArr[3];
      }
    }
    return response;
  }

  static getDefaultIntersectResponse() {
    return {
      xOff: 0,
      yOff: 0,
      intersect: {
        type: 'none',
        point: {
          x: 0,
          y: 0
        }
      }
    };
  }

  static getRotatedRectIntersect(defSvgRotatedRectElement: any, src: any, trg: any, includesArrow?: boolean = true) {
    const response = Edge.getDefaultIntersectResponse();
    const arrowSize = Edge.getArrowSize();
    const clientRect = defSvgRotatedRectElement.getBoundingClientRect();

    const widthAttr = defSvgRotatedRectElement.getAttribute('width');
    const heightAttr = defSvgRotatedRectElement.getAttribute('height');
    const w = widthAttr ? parseFloat(widthAttr) : clientRect.width;
    const h = heightAttr ? parseFloat(heightAttr) : clientRect.height;
    const trgX = trg.x || 0;
    const trgY = trg.y || 0;
    const srcX = src.x || 0;
    const srcY = src.y || 0;

    const top = trgY - h / 2;
    const bottom = trgY + h / 2;
    const left = trgX - w / 2;
    const right = trgX + w / 2;

    const line = shape('line', { x1: srcX, y1: srcY, x2: trgX, y2: trgY });

    // define rectangle
    let rect = {
        topLeft: new Point2D(left, top),
        bottomRight: new Point2D(right, bottom)
    };

    // convert rectangle corners to polygon (list of points)
    let poly = [
      rect.topLeft,
      new Point2D(rect.bottomRight.x, rect.topLeft.y),
      rect.bottomRight,
      new Point2D(rect.topLeft.x, rect.bottomRight.y)
    ];

    // find center point of rectangle
    let center = rect.topLeft.lerp(rect.bottomRight, 0.5);

    // get the rotation
    let transform = defSvgRotatedRectElement.getAttribute('transform');
    let rotate = transform ? transform.replace(/(rotate.[0-9]*.)|[^]/g, '$1') : null;
    let angle = 0;
    if (rotate) {
      // get the number
      rotate = rotate.replace(/^rotate\(|\)$/g, '');
      // define rotation in radians
      angle = parseFloat(rotate) * Math.PI / 180.0;
    }
    // create matrix for rotating around center of rectangle
    let rotation = Matrix2D.rotationAt(angle, center);
    // create new rotated polygon
    const rotatedPoly = poly.map(p => p.transform(rotation));

    // find intersections
    const pathIntersect = Intersection.intersectLinePolygon(line.params[0], line.params[1], rotatedPoly);

    if (pathIntersect.points.length > 0) {
      let arrowWidth = 0; //arrowSize.width;
      let arrowHeight = 0; //arrowSize.height;
      const xIntersect = pathIntersect.points[0].x;
      const yIntersect = pathIntersect.points[0].y;
      if (xIntersect > left && xIntersect < right && yIntersect > trgY) {
        // arrow points to the top of the node
        arrowHeight = arrowSize.height;
      } else if (xIntersect > left && xIntersect < right && yIntersect < trgY) {
        // arrow points to the bottom of the node
        arrowHeight = -arrowSize.height;
      } else if (yIntersect > top && yIntersect < bottom && xIntersect < trgX) {
        // arrow points to the left of the node
        arrowWidth = -arrowSize.width;
      } else {
        // arrow points to the right of the node
        arrowWidth = arrowSize.width;
      }
      response.xOff = trgX - xIntersect - (includesArrow ? arrowWidth / 1.25 : 0);
      response.yOff = trgY - yIntersect - (includesArrow ? arrowHeight / 1.25 : 0);
      response.intersect = pathIntersect.points[0];
    }
    return response;
  }

  static getPathIntersect(defSvgPathElement: any, src: any, trg: any, includesArrow?: boolean = true) {
    const response = Edge.getDefaultIntersectResponse();
    const arrowSize = Edge.getArrowSize();
    // get the rectangular area around path
    const clientRect = defSvgPathElement.getBoundingClientRect();

    const w = clientRect.width;
    const h = clientRect.height;
    const trgX = trg.x || 0;
    const trgY = trg.y || 0;
    const srcX = src.x || 0;
    const srcY = src.y || 0;

    // calculate the positions of each corner relative to the trg position
    const top = trgY - h / 2;
    const left = trgX - w / 2;

    // modify the d property to add top and left to the x and y positions
    let d = defSvgPathElement.getAttribute('d');
    if (!/^M/.test(d)) {
      // doesn't look like what we expect.
      // TODO: add more use cases than simple moveTo commands
      return;
    }

    d = d.replace(/^M /, '');
    let dArr = d.split(' ');
    dArr = dArr.map((val, index) => {
      let isEnd = false;
      if (/Z$/.test(val)) {
        val = val.replace(/Z$/, '');
        isEnd = true;
      }
      // items % 2 are x positions
      if (index % 2 === 0) {
        return (parseFloat(val) + left) + (isEnd ? 'Z' : '');
      }
      return (parseFloat(val) + top) + (isEnd ? 'Z' : '');
    });

    const pathIntersect = intersect(
      shape('path', { d: 'M ' + dArr.join(' ') }),
      shape('line', { x1: srcX, y1: srcY, x2: trgX, y2: trgY })
    );

    if (pathIntersect.points.length > 0) {
      let arrowWidth = arrowSize.width;
      let arrowHeight = arrowSize.height;
      // arrow points to the left of node
      if (pathIntersect.points[0].x < trgX) {
        arrowWidth *= -1;
      }
      // arrow points at the bottom of node
      if (pathIntersect.points[0].y < trgY) {
        arrowHeight *= -1;
      }
      response.xOff = trgX - pathIntersect.points[0].x - (includesArrow ? arrowWidth / 1.25 : 0);
      response.yOff = trgY - pathIntersect.points[0].y - (includesArrow ? arrowHeight / 1.25 : 0);
      response.intersect = pathIntersect.points[0];
    }
    return response;
  }

  static getCircleIntersect(defSvgCircleElement: any, src: any, trg: any, includesArrow?: boolean = true) {
    const response = Edge.getDefaultIntersectResponse();
    const arrowSize = Edge.getArrowSize();
    let arrowWidth = arrowSize.width;
    let arrowHeight = arrowSize.height;
    const theta = Edge.getTheta(src, trg);
    const clientRect = defSvgCircleElement.getBoundingClientRect();
    const parentElement = defSvgCircleElement.parentElement;
    let parentWidth = parentElement.getAttribute('width');
    let parentHeight = parentElement.getAttribute('width');
    if (parentWidth) {
      parentWidth = parseFloat(parentWidth);
    }
    if (parentHeight) {
      parentHeight = parseFloat(parentHeight);
    }

    const w = parentWidth ? parentWidth : clientRect.width;
    const h = parentHeight ? parentHeight : clientRect.height;
    const trgX = trg.x || 0;
    const trgY = trg.y || 0;
    const srcX = src.x || 0;
    const srcY = src.y || 0;
    const top = trgY - h / 2;
    const bottom = trgY + h / 2;
    const left = trgX - w / 2;
    const right = trgX + w / 2;
    // from the center of the node to the perimeter
    let offX = w / 2;
    let offY = h / 2;

    // Note: even though this is a circle function, we can use ellipse
    // because all circles are ellipses but not all ellipses are circles.
    const pathIntersect = intersect(
      shape('ellipse', { rx: offX + arrowHeight, ry: offY + arrowHeight, cx: trgX - arrowHeight/1.25, cy: trgY - arrowHeight/1.25 }),
      shape('line', { x1: srcX, y1: srcY, x2: trgX, y2: trgY })
    );

    if (pathIntersect.points.length > 0) {
      let arrowWidth = arrowSize.width / 1.25;
      let arrowHeight = arrowSize.height / 1.25;
      const xIntersect = pathIntersect.points[0].x;
      const yIntersect = pathIntersect.points[0].y;

      response.xOff = trgX - pathIntersect.points[0].x - (includesArrow ? arrowWidth : 0)
      response.yOff = trgY - pathIntersect.points[0].y - (includesArrow ? arrowHeight : 0);
      response.intersect = pathIntersect.points[0];
    }
    return response;
  }

  static calculateOffset(nodeSize: any, src: any, trg: any, nodeKey: string, includesArrow?: boolean = true) {
    let response = Edge.getDefaultIntersectResponse();

    const trgNode = document.querySelector(`#node-${trg[nodeKey]} use.node`);

    // the test for trgNode.getAttributeNS makes sure we really have a node and not some other type of object
    if (trgNode && trgNode.getAttributeNS) {
      const xlinkHref = trgNode.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (xlinkHref) {
        const defSvgRectElement: any = document.querySelector(`defs>${xlinkHref} rect`);
        const defSvgPathElement: any = document.querySelector(`defs>${xlinkHref} path`);
        const defSvgCircleElement: any = document.querySelector(`defs>${xlinkHref} circle, defs>${xlinkHref} ellipse, defs>${xlinkHref} polygon`);

        if (defSvgRectElement) {
          // it's a rectangle
          response = {
            ...response,
            ...Edge.getRotatedRectIntersect(defSvgRectElement, src, trg, includesArrow)
          }
        } else if (defSvgPathElement) {
          // it's a complex path
          response = {
            ...response,
            ...Edge.getPathIntersect(defSvgPathElement, src, trg, includesArrow)
          }
        } else {
          // it's a circle or some other type
          response = {
            ...response,
            ...Edge.getCircleIntersect(defSvgCircleElement, src, trg, includesArrow)
          }
        }
      }
    }

    return response;
  }

  static getXlinkHref(edgeTypes: any, data: any) {
    if (data.type && edgeTypes[data.type]) {
      return edgeTypes[data.type].shapeId;
    } else if (edgeTypes.emptyEdge) {
      return edgeTypes.emptyEdge.shapeId;
    }
    return null;
  }

  edgeOverlayRef;

  constructor(props: IEdgeProps) {
    super(props);
    this.edgeOverlayRef = React.createRef();
  }

  getEdgeHandleTranslation = () => {
    const { nodeSize, nodeKey, sourceNode, targetNode, data } = this.props;

    let pathDescription = this.getPathDescription(data);

    pathDescription = pathDescription.replace(/^M/, '');
    pathDescription = pathDescription.replace(/L/, ',');
    const pathDescriptionArr = pathDescription.split(',');

    // [0] = src x, [1] = src y
    // [2] = trg x, [3] = trg y
    const diffX = parseFloat(pathDescriptionArr[2]) - parseFloat(pathDescriptionArr[0]);
    const diffY = parseFloat(pathDescriptionArr[3]) - parseFloat(pathDescriptionArr[1]);
    const x = parseFloat(pathDescriptionArr[0]) + diffX / 2;
    const y = parseFloat(pathDescriptionArr[1]) + diffY / 2;

    return `translate(${x}, ${y})`;
  }

  getEdgeHandleOffsetTranslation = () => {
    const offset = -(this.props.edgeHandleSize || 0) / 2;
    return `translate(${offset}, ${offset})`;
  }

  getEdgeHandleRotation = (negate: any = false) => {
    const src = this.props.sourceNode;
    const trg = this.props.targetNode;
    let theta = Edge.getTheta(src, trg) * 180 / Math.PI;
    if (negate) {
      theta = -theta;
    }
    return `rotate(${theta})`;
  }

  getEdgeHandleTransformation = () => {
    const translation = this.getEdgeHandleTranslation();
    const rotation = this.getEdgeHandleRotation();
    const offset = this.getEdgeHandleOffsetTranslation();
    return `${translation} ${rotation} ${offset}`;
  }

  getPathDescription(edge: any) {
    const { sourceNode, targetNode, nodeKey, nodeSize } = this.props;
    const trgX = targetNode && targetNode.x ? targetNode.x : 0;
    const trgY = targetNode && targetNode.y ? targetNode.y : 0;
    const srcX = targetNode && sourceNode.x ? sourceNode.x : 0;
    const srcY = targetNode && sourceNode.y ? sourceNode.y : 0;

    // To calculate the offset for a specific node we use that node as the third parameter
    // and the accompanying node as the second parameter, representing where the line
    // comes from and where it's going to. Don't think of a line as a one-way arrow, but rather
    // a connection between two points. In this case, to obtain the offsets for the src we
    // write trg first, then src second. Vice versa to get the offsets for trg.
    const srcOff = Edge.calculateOffset(nodeSize || 0, targetNode, sourceNode, nodeKey, false);
    const trgOff = Edge.calculateOffset(nodeSize || 0, sourceNode, targetNode, nodeKey);

    const linePoints = [
      {
        x: srcX - srcOff.xOff,
        y: srcY - srcOff.yOff
      },
      {
        x: trgX - trgOff.xOff,
        y: trgY - trgOff.yOff
      }
    ];

    return Edge.lineFunction(linePoints);
  }

  renderHandleText(data: any) {
    return (
      <text
        className="edge-text"
        textAnchor="middle"
        alignmentBaseline="central"
        transform={`${this.getEdgeHandleTranslation()}`}
      >
        {data.handleText}
      </text>
    );
  }

  render() {
    const { data, edgeTypes, edgeHandleSize } = this.props;
    const id = `${data.source || ''}_${data.target}`;
    const className = GraphUtils.classNames('edge', {
      selected: this.props.isSelected
    });

    return (
      <g className="edge-container" data-source={data.source} data-target={data.target}>
        <g className={className}>
          <path className="edge-path" d={this.getPathDescription(data) || undefined} />
            <use
              xlinkHref={Edge.getXlinkHref(edgeTypes, data)}
              width={edgeHandleSize}
              height={edgeHandleSize}
              transform={`${this.getEdgeHandleTransformation()}`}
            />
            {data.handleText && this.renderHandleText(data)}
        </g>
        <g className="edge-mouse-handler">
          <path
            className="edge-overlay-path"
            ref={this.edgeOverlayRef}
            id={id}
            data-source={data.source}
            data-target={data.target}
            d={this.getPathDescription(data) || undefined}
          />
        </g>
      </g>
    );
  }
}

export default Edge;
