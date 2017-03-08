import {Observable} from "rxjs/Observable";
import {Subscription} from "rxjs/Subscription";

import "rxjs/add/observable/combineLatest";

import "rxjs/add/operator/distinctUntilChanged";
import "rxjs/add/operator/map";
import "rxjs/add/operator/throttleTime";

import {ILatLon} from "../API";
import {
    ILatLonAlt,
    Transform,
} from "../Geo";
import {
    IEdgeStatus,
    Node,
} from "../Graph";
import {RenderCamera} from "../Render";
import {EventEmitter} from "../Utils";
import {
    Container,
    IUnprojection,
    IViewerMouseEvent,
    Navigator,
    Projection,
    Viewer,
} from "../Viewer";

export class EventLauncher {
    private _started: boolean;

    private _bearingSubscription: Subscription;
    private _currentNodeSubscription: Subscription;
    private _loadingSubscription: Subscription;
    private _moveSubscription: Subscription;
    private _sequenceEdgesSubscription: Subscription;
    private _spatialEdgesSubscription: Subscription;
    private _viewerMouseEventSubscription: Subscription;

    private _container: Container;
    private _eventEmitter: EventEmitter;
    private _navigator: Navigator;
    private _projection: Projection;

    constructor(eventEmitter: EventEmitter, navigator: Navigator, container: Container) {
        this._container = container;
        this._eventEmitter = eventEmitter;
        this._navigator = navigator;
        this._projection = new Projection();

        this._started = false;
    }

    public get started(): boolean {
        return this._started;
    }

    public start(): void {
        if (this._started) {
            return;
        }

        this._started = true;

        this._loadingSubscription = this._navigator.loadingService.loading$
            .subscribe((loading: boolean): void => {
                this._eventEmitter.fire(Viewer.loadingchanged, loading);
            });

        this._currentNodeSubscription = this._navigator.stateService.currentNodeExternal$
            .subscribe((node: Node): void => {
                this._eventEmitter.fire(Viewer.nodechanged, node);
            });

        this._sequenceEdgesSubscription = this._navigator.stateService.currentNodeExternal$
            .switchMap(
                (node: Node): Observable<IEdgeStatus> => {
                    return node.sequenceEdges$;
                })
            .subscribe(
                (status: IEdgeStatus): void => {
                    this._eventEmitter.fire(Viewer.sequenceedgeschanged, status);
                });

        this._spatialEdgesSubscription = this._navigator.stateService.currentNodeExternal$
            .switchMap(
                (node: Node): Observable<IEdgeStatus> => {
                    return node.spatialEdges$;
                })
            .subscribe(
                (status: IEdgeStatus): void => {
                    this._eventEmitter.fire(Viewer.spatialedgeschanged, status);
                });

        this._moveSubscription = Observable
            .combineLatest(
                this._navigator.stateService.inMotion$,
                this._container.mouseService.active$,
                this._container.touchService.active$)
            .map(
                (values: boolean[]): boolean => {
                    return values[0] || values[1] || values[2];
                })
            .distinctUntilChanged()
            .subscribe(
                (started: boolean) => {
                    if (started) {
                        this._eventEmitter.fire(Viewer.movestart, null);
                    } else {
                        this._eventEmitter.fire(Viewer.moveend, null);
                    }
                });

        this._bearingSubscription = this._container.renderService.bearing$
            .throttleTime(100)
            .distinctUntilChanged(
                (b1: number, b2: number): boolean => {
                    return Math.abs(b2 - b1) < 1;
                })
            .subscribe(
                (bearing): void => {
                    this._eventEmitter.fire(Viewer.bearingchanged, bearing);
                 });

        const click$: Observable<[string, MouseEvent]> = this._container.mouseService.staticClick$
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["click", event];
                });

        const mouseDown$: Observable<[string, MouseEvent]> = this._container.mouseService.mouseDown$
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["mousedown", event];
                });

        const mouseMove$: Observable<[string, MouseEvent]> = this._container.mouseService.active$
            .switchMap(
                (active: boolean): Observable<MouseEvent> => {
                    return active ?
                        Observable.empty<MouseEvent>() :
                        this._container.mouseService.mouseMove$;
                })
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["mousemove", event];
                });

        const mouseOut$: Observable<[string, MouseEvent]> = this._container.mouseService.mouseOut$
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["mouseout", event];
                });


        const mouseOver$: Observable<[string, MouseEvent]> = this._container.mouseService.mouseOver$
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["mouseover", event];
                });

        const mouseUp$: Observable<[string, MouseEvent]> = this._container.mouseService.mouseUp$
            .map(
                (event: MouseEvent): [string, MouseEvent] => {
                    return ["mouseup", event];
                });

        this._viewerMouseEventSubscription = Observable
            .merge(
                click$,
                mouseDown$,
                mouseMove$,
                mouseOut$,
                mouseOver$,
                mouseUp$)
            .withLatestFrom(
                this._container.renderService.renderCamera$,
                this._navigator.stateService.reference$,
                this._navigator.stateService.currentTransform$)
            .map(
                ([[type, event], render, reference, transform]:
                [[string, MouseEvent], RenderCamera, ILatLonAlt, Transform]): IViewerMouseEvent => {
                    const unprojection: IUnprojection =
                        this._projection.unprojectFromEvent(
                            event,
                            this._container.element,
                            render,
                            reference,
                            transform);

                    return  {
                        basicPoint: unprojection.basicPoint,
                        latLon: unprojection.latLon,
                        originalEvent: event,
                        pixelPoint: unprojection.pixelPoint,
                        target: <Viewer>this._eventEmitter,
                        type: type,
                    };
                })
            .subscribe(
                (event: IViewerMouseEvent): void => {
                    this._eventEmitter.fire(event.type, event);
                });
    }

    public stop(): void {
        if (!this.started) {
            return;
        }

        this._started = false;

        this._bearingSubscription.unsubscribe();
        this._loadingSubscription.unsubscribe();
        this._currentNodeSubscription.unsubscribe();
        this._moveSubscription.unsubscribe();
        this._sequenceEdgesSubscription.unsubscribe();
        this._spatialEdgesSubscription.unsubscribe();
        this._viewerMouseEventSubscription.unsubscribe();

        this._bearingSubscription = null;
        this._loadingSubscription = null;
        this._currentNodeSubscription = null;
        this._moveSubscription = null;
        this._sequenceEdgesSubscription = null;
        this._spatialEdgesSubscription = null;
        this._viewerMouseEventSubscription = null;
    }

    public unproject$(pixelPoint: number[]): Observable<ILatLon> {
        return Observable
            .combineLatest(
                this._container.renderService.renderCamera$,
                this._navigator.stateService.reference$,
                this._navigator.stateService.currentTransform$)
            .first()
            .map(
                ([render, reference, transform]: [RenderCamera, ILatLonAlt, Transform]): ILatLon => {
                    const unprojection: IUnprojection =
                        this._projection.unprojectFromCanvas(
                            pixelPoint,
                            this._container.element,
                            render,
                            reference,
                            transform);

                    return unprojection.latLon;
                });
    }
}

export default EventLauncher;
